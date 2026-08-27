'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Check, Inbox } from 'lucide-react';
import { api, errMessage } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useRefreshHold, usePortalRefresh } from '@/components/PortalRefresh';
import { NotifyModal } from '@/components/delivery/NotifyModal';
import type { AlertFeed, DeliveryAlert } from '@/lib/alerts';
import type { DeliveryWithMerchant } from '@/lib/types';

/**
 * Which alerts this browser has already looked at.
 *
 * The alerts themselves are derived from delivery status and are never dismissed
 * — the state *is* the alert, so a row leaves the list the moment whoever it was
 * waiting on acts. "Unread" is a strictly separate and strictly local question:
 * has this browser opened the panel since this alert appeared. It lives in
 * localStorage for that reason — it is a property of a screen somebody is looking
 * at, not of the delivery, and it is nobody else's business.
 */
const SEEN_KEY = 'somo.alerts.seen';

/** How long the bell keeps its one-shot ring after a new alert lands. */
const PING_MS = 700;

interface AlertsApi {
  /** Every outstanding alert, capped for payload — see ALERT_LIST_LIMIT. */
  feed: AlertFeed;
  /** Outstanding alerts this browser has not looked at yet. */
  unread: number;
  /**
   * Which alerts were still unseen at the moment the panel was opened.
   *
   * A snapshot rather than live `seen`, because opening the panel is what marks
   * everything seen — a live marker would flip to "read" on the same frame the
   * reader's eye reached it, which is no marker at all. Held for the life of the
   * panel, so "these three are the new ones" survives being looked at.
   */
  newAtOpen: Set<string>;
  panelOpen: boolean;
  /** True for the moment after a new alert arrives, for the bell's one-shot ring. */
  pinged: boolean;
  /** Open the panel — the bell, and the delivery log's summary strip. */
  open: () => void;
  /** Close without moving focus; the bell adds its own focus return. */
  dismiss: () => void;
  /** Which delivery is mid-confirmation, or ''. */
  confirming: string;
  confirmPickup: (id: string) => void;
  openNotify: (record: DeliveryWithMerchant) => void;
}

const AlertsContext = createContext<AlertsApi | null>(null);

function useAlertsContext(): AlertsApi {
  const value = useContext(AlertsContext);
  if (!value) throw new Error('Alerts components must be rendered inside <AlertsProvider>');
  return value;
}

/**
 * What the delivery log's summary strip reads. Returns null outside the portal
 * layout so a surface without a bell can render without one.
 */
export function useAlerts(): AlertsApi | null {
  return useContext(AlertsContext);
}

function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    // Private browsing, a corrupt value, or storage off. Everything reads as new,
    // which is the safe direction to fail in for something asking for attention.
    return new Set();
  }
}

/**
 * Holds the alert state for the whole portal, so the topbar bell and the delivery
 * log's summary strip read one number rather than two.
 */
export function AlertsProvider({
  feed,
  opsPhone,
  children,
}: {
  feed: AlertFeed;
  opsPhone: string;
  children: React.ReactNode;
}) {
  const toast = useToast();
  const pathname = usePathname();
  const { refreshNow } = usePortalRefresh();

  const [panelOpen, setPanelOpen] = useState(false);
  const [notify, setNotify] = useState<DeliveryWithMerchant | null>(null);
  const [confirming, setConfirming] = useState('');
  const [pinged, setPinged] = useState(false);
  /**
   * `null` until the effect below has read localStorage.
   *
   * The server has no localStorage, so reading it during render would make the
   * first client render disagree with the server's and throw a hydration error.
   * Until it resolves there is no count — which is a frame, not a state anybody
   * reads.
   */
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const [newAtOpen, setNewAtOpen] = useState<Set<string>>(() => new Set());

  /** The keys as of the previous render, for spotting what is genuinely new. */
  const previousKeys = useRef<Set<string> | null>(null);
  const seenRef = useRef<Set<string> | null>(null);
  seenRef.current = seen;

  useEffect(() => setSeen(readSeen()), []);

  // A stable primitive for the effects and memos below: the key list is a new
  // array on every server render, so depending on it directly would re-fire all
  // of them 25 seconds apart whether or not anything actually changed.
  const keySignature = feed.keys.join(' ');

  /**
   * Tell somebody when something new arrives.
   *
   * The first run only records a baseline: a page load is not news, and toasting
   * a backlog on every navigation would train people to ignore the toast. From
   * then on, a key that was not in the previous render is a delivery that moved
   * while this screen was open — which is exactly the case nobody would otherwise
   * notice, because it happened on somebody else's phone.
   */
  useEffect(() => {
    const current = new Set(feed.keys);
    const before = previousKeys.current;
    previousKeys.current = current;
    if (!before) return;

    const alreadySeen = seenRef.current;
    const fresh = feed.keys.filter((k) => !before.has(k) && !alreadySeen?.has(k));
    if (fresh.length === 0) return;

    setPinged(true);
    if (fresh.length === 1) {
      const item = feed.items.find((i) => i.key === fresh[0]);
      // Name the delivery when it is one we hold. A single alert past the payload
      // cap falls through to the count, which is still true.
      toast(item ? `${item.action} — ${item.record.customer}` : '1 new alert', 'alert');
    } else {
      toast(`${fresh.length} new alerts need your attention`, 'alert');
    }
    // feed.keys and feed.items come from one server payload, so the signature
    // covers both; naming them here would re-fire this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature, toast]);

  useEffect(() => {
    if (!pinged) return;
    const timer = setTimeout(() => setPinged(false), PING_MS);
    return () => clearTimeout(timer);
  }, [pinged]);

  const unread = useMemo(() => {
    if (!seen) return 0;
    return feed.keys.reduce((n, k) => (seen.has(k) ? n : n + 1), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature, seen]);

  /**
   * Opening the panel is the read event. There is no "mark all as read" control
   * because there is nothing one would add: looking at the list is what looking
   * at the list means.
   *
   * Every outstanding key is marked, not only the ones the panel had room to list
   * — the footer says how many more there are and where they live, so they have
   * been accounted for either way. The stored set is pruned to what is still
   * outstanding on every write, so it cannot grow without bound.
   */
  const markSeen = useCallback((keys: string[]) => {
    const next = new Set(keys);
    setSeen(next);
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
    } catch {
      // Storage unavailable. The count resets on the next load, which is worse
      // than persisting it and better than failing to open.
    }
  }, []);

  const open = useCallback(() => {
    setPanelOpen(true);
    setPinged(false);
  }, []);
  const dismiss = useCallback(() => setPanelOpen(false), []);

  // Marked on open rather than on close, so the count clears the instant somebody
  // looks — and an alert arriving while the panel is still open is marked too, and
  // joins the snapshot, so it is still flagged as the new one.
  useEffect(() => {
    if (!panelOpen) return;
    const wasSeen = seenRef.current;
    setNewAtOpen((carried) => {
      const next = new Set(carried);
      for (const key of feed.keys) if (!wasSeen?.has(key)) next.add(key);
      return next;
    });
    markSeen(feed.keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, keySignature, markSeen]);

  // Cleared on close, not on open: the snapshot has to outlive the markSeen above.
  useEffect(() => {
    if (!panelOpen) setNewAtOpen(new Set());
  }, [panelOpen]);

  // Travelling to a tab from inside the panel should leave the panel behind.
  useEffect(() => setPanelOpen(false), [pathname]);

  // A panel somebody is reading, and a modal somebody is copying a link out of,
  // both hold the portal's poll still.
  useRefreshHold(panelOpen || !!notify);

  const openNotify = useCallback((record: DeliveryWithMerchant) => {
    setPanelOpen(false);
    setNotify(record);
  }, []);

  /** The merchant's one transition, and the customer message that follows it. */
  const confirmPickup = useCallback(
    async (id: string) => {
      setConfirming(id);
      try {
        const data = await api<{ delivery: DeliveryWithMerchant; alertsSent: boolean }>(
          `/deliveries/${id}/pickup`,
          { method: 'POST' }
        );
        toast(
          data.alertsSent
            ? 'Pickup confirmed — the customer has been texted'
            : 'Pickup confirmed'
        );
        setPanelOpen(false);
        refreshNow();
        // Only when the portal could not send it. With SMS on, the customer
        // already has their "on the way" message and their confirmation link,
        // and a modal here would be an invitation to send it a second time.
        if (!data.alertsSent) setNotify(data.delivery);
      } catch (e) {
        toast(errMessage(e), 'danger');
        refreshNow();
      }
      setConfirming('');
    },
    [toast, refreshNow]
  );

  const value = useMemo<AlertsApi>(
    () => ({
      feed,
      unread,
      newAtOpen,
      panelOpen,
      pinged,
      open,
      dismiss,
      confirming,
      confirmPickup,
      openNotify,
    }),
    [feed, unread, newAtOpen, panelOpen, pinged, open, dismiss, confirming, confirmPickup, openNotify]
  );

  return (
    <AlertsContext.Provider value={value}>
      {children}
      <NotifyModal record={notify} opsPhone={opsPhone} onClose={() => setNotify(null)} />
    </AlertsContext.Provider>
  );
}

/**
 * The topbar's bell and the panel it opens.
 *
 * The attention queue used to be a band above the delivery table, where it was
 * both the loudest thing on the busiest screen and invisible from every other
 * tab. As a bell it costs one glyph until somebody wants it, and it is now on the
 * ledger, the dashboard and the settings pane too — which is where a delivery
 * moving on a rider's phone was previously impossible to notice.
 */
export function AlertBell() {
  const {
    feed,
    unread,
    newAtOpen,
    panelOpen,
    pinged,
    open,
    dismiss,
    confirming,
    confirmPickup,
    openNotify,
  } = useAlertsContext();

  const bellRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    dismiss();
    bellRef.current?.focus();
  }, [dismiss]);

  // Focus moves into the panel, so a keyboard user is reading what they opened
  // and Tab walks the rows rather than the topbar behind them.
  useEffect(() => {
    if (panelOpen) panelRef.current?.focus();
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // pointerdown rather than click, and no scrim: a scrim over the topbar would
    // make the account badge beside the bell unclickable while the panel is open,
    // which is a worse trade than listening on the document.
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) dismiss();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [panelOpen, close, dismiss]);

  const hidden = feed.total - feed.items.length;

  return (
    <div className="somo-bell" ref={wrapRef}>
      <button
        type="button"
        ref={bellRef}
        className={`somo-bell-btn${panelOpen ? ' open' : ''}${pinged ? ' ping' : ''}`}
        aria-expanded={panelOpen}
        aria-controls="somo-alerts-panel"
        aria-label={
          unread > 0
            ? `Alerts — ${unread} not yet seen, ${feed.total} outstanding`
            : feed.total > 0
              ? `Alerts — ${feed.total} outstanding`
              : 'Alerts — nothing needs attention'
        }
        onClick={() => (panelOpen ? close() : open())}
      >
        <Bell aria-hidden="true" size={18} />
        {unread > 0 ? (
          // aria-hidden: the button's own label already carries the number in a
          // sentence, and a bare "6" read out after it is noise.
          <span className="somo-bell-count" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {panelOpen ? (
        <div
          className="somo-bell-panel"
          id="somo-alerts-panel"
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-label="Alerts"
        >
          <div className="somo-bell-head">
            <span>Needs attention</span>
            {feed.total > 0 ? <span className="count">{feed.total}</span> : null}
          </div>

          {feed.items.length === 0 ? (
            <div className="somo-bell-empty">
              <Inbox aria-hidden="true" size={22} />
              <span className="big">Nothing needs your attention</span>
              <span>
                A delivery appears here the moment it is waiting on you — a request to
                assign, a rider to chase, a message to send.
              </span>
            </div>
          ) : (
            <ul className="somo-bell-list">
              {feed.items.map((item) => (
                <AlertRow
                  key={item.key}
                  item={item}
                  isNew={newAtOpen.has(item.key)}
                  confirming={confirming === item.record.id}
                  onConfirm={() => confirmPickup(item.record.id)}
                  onNotify={() => openNotify(item.record)}
                />
              ))}
            </ul>
          )}

          {hidden > 0 ? (
            <Link className="somo-bell-more" href="/portal/log">
              and {hidden} more waiting — open the delivery log
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AlertRow({
  item,
  isNew,
  confirming,
  onConfirm,
  onNotify,
}: {
  item: DeliveryAlert;
  isNew: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onNotify: () => void;
}) {
  return (
    <li className="somo-bell-row">
      <span className="what">
        <span className="act">
          {item.action}
          {/* A word beside the tint, not a bare coloured dot: the same
              soft-tint-plus-accent tag the role badges use, so "new" is readable
              without the colour and findable because of it. */}
          {isNew ? <span className="somo-alert-new">new</span> : null}
        </span>
        {/* Route lines are long and this panel is narrow, so it truncates rather
            than wrapping every row to three lines. */}
        <span className="sub">
          {item.record.customer} · {item.record.pickup} → {item.record.dropoff}
        </span>
      </span>
      {item.confirmPickup ? (
        <button type="button" className="somo-notify-btn" disabled={confirming} onClick={onConfirm}>
          <Check aria-hidden="true" size={14} />
          <span>{confirming ? 'Confirming…' : 'Confirm'}</span>
        </button>
      ) : (
        <button type="button" className="somo-notify-btn" onClick={onNotify}>
          <Bell aria-hidden="true" size={14} />
          <span>Notify</span>
        </button>
      )}
    </li>
  );
}

'use client';

import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * How often the portal re-reads itself.
 *
 * Riders and customers move deliveries along from their own phones, so the most
 * important changes originate somewhere else entirely — a decline, a pickup, a
 * recipient confirming receipt. Without this, whoever is signed in sits looking
 * at whatever was true when the page loaded and only finds out by reloading,
 * which nobody thinks to do.
 *
 * A soft `router.refresh()`, so the server re-renders without losing scroll
 * position, open dropdowns or the modal. Twenty-five seconds is short enough that
 * "confirmed" appears while you are still looking at the screen, and long enough
 * that a room of open tabs is not hammering the database.
 */
const REFRESH_MS = 25_000;

/**
 * How far each tick is allowed to wander from REFRESH_MS, as a fraction.
 *
 * Left on a fixed interval, tabs that started together stay together forever.
 * They start together more often than it sounds: a deploy, a container restart
 * after the export OOM, or a dropped connection sends everyone's browser to the
 * same page within a second or two, and from then on every one of their polls
 * lands in the same moment — a re-render of the layout and the page, each
 * paging a year of deliveries out of PostgREST, all at once, against a server
 * that has just come up cold.
 *
 * ±15% redrawn on every tick, so a room that started in lockstep is spread
 * across the window within a cycle or two and stays spread. It costs nothing
 * and it is not a queue: the point is only that the ticks stop agreeing.
 */
const REFRESH_JITTER = 0.15;

/**
 * The shortest gap between two freshness checks, whatever asked for them.
 *
 * Returning to the tab triggers one immediately, which is right the first time
 * and wasteful the next four: alt-tabbing to check something and back, or a
 * phone waking and locking, fires visibilitychange every time. Nine o'clock —
 * a floor of people arriving and opening the tab they left open — is exactly
 * the correlated burst the jitter above exists to prevent, arriving by the one
 * path jitter does not cover.
 *
 * A check, not a refresh, because since the pulse those are different things and
 * this has to bound the cheaper one too. It also does the work of an in-flight
 * guard: three quick returns cannot start three overlapping pulse requests,
 * because the first one claims the window before it awaits anything.
 */
const MIN_GAP_MS = 10_000;

/**
 * How long to wait for the "has anything changed?" answer before giving up.
 *
 * Well inside the cycle, because the next tick is armed after this one finishes.
 * A pulse request that hung would otherwise stop the poll altogether, which is
 * the one failure this whole mechanism must not have — a portal that quietly
 * never updates again is worse than one that reads too much.
 */
const PULSE_TIMEOUT_MS = 8_000;

/**
 * One poll for the whole portal.
 *
 * This used to live inside the delivery log, which was fine while the log was the
 * only screen that went stale. The alert bell sits in the topbar of every tab and
 * has to be current on all of them, so the interval moved up here — one timer per
 * open portal rather than one per screen that happens to care. A refresh renders
 * the layout as well as the page, so the bell and whatever is under it always
 * agree.
 */
interface RefreshApi {
  /** Take a hold; call the returned function to release it. */
  hold: () => () => void;
  /** The impatient path — same soft refresh, on demand. */
  refreshNow: () => void;
}

const RefreshContext = createContext<RefreshApi>({
  hold: () => () => {},
  refreshNow: () => {},
});

export function PortalRefresh({
  /**
   * The portal_pulse revision the current page was rendered at, or null when the
   * server could not read it.
   *
   * Null means the question cannot be asked, so it is not asked: the poll falls
   * straight through to refreshing on every tick, exactly as it did before the
   * pulse existed. That is what lets this ship ahead of its migration.
   */
  pulse,
  children,
}: {
  pulse: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  /**
   * How many things are currently asking the poll to leave the screen alone.
   *
   * A ref rather than state on purpose: a hold must not re-create the interval,
   * or opening and closing a modal would reset the countdown every time.
   */
  const holds = useRef(0);

  const hold = useCallback(() => {
    holds.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds.current -= 1;
    };
  }, []);

  /**
   * When this tab last did anything about being current — refreshed, or asked
   * the pulse whether it needed to.
   *
   * A ref so the poll and the Refresh button share one answer: pressing Refresh
   * and then switching tabs should not be followed by a second read a second
   * later, which is the whole point of MIN_GAP_MS. Mount seeds it, because the
   * page on screen is what the server just rendered.
   */
  const lastCheckAt = useRef(Date.now());

  const refreshNow = useCallback(() => {
    // Recorded, but never blocked, and never gated on the pulse. This is
    // somebody pressing a button, and a Refresh that quietly does nothing reads
    // as broken however sound the reasoning behind it.
    lastCheckAt.current = Date.now();
    router.refresh();
  }, [router]);

  /**
   * The revision the page currently on screen was rendered at.
   *
   * Taken from the prop rather than from the last pulse the poll fetched, which
   * matters: the baseline has to describe what the server actually rendered. If
   * a refresh is dropped — offline, or a navigation cancelling it — this stays
   * where it was and the next tick tries again, instead of recording a revision
   * nobody ever rendered and going quiet on a stale screen.
   */
  const renderedAt = useRef(pulse);
  useEffect(() => {
    renderedAt.current = pulse;
  }, [pulse]);

  useEffect(() => {
    // A self-rearming timeout rather than setInterval, because the delay has to
    // be redrawn between ticks — an interval only gets to pick its period once.
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Set by the cleanup. An in-flight pulse request outlives the unmount, and
    // what comes back must not refresh a router this component no longer has,
    // nor arm a timer nothing will ever clear.
    let stopped = false;

    const nextDelay = () => REFRESH_MS * (1 + (Math.random() * 2 - 1) * REFRESH_JITTER);
    const arm = () => {
      timer = setTimeout(tick, nextDelay());
    };

    const refresh = () => {
      lastCheckAt.current = Date.now();
      router.refresh();
    };

    const shouldRefresh = () => {
      // Held while a modal is open: re-rendering underneath someone who is
      // mid-way through copying a link is worse than being 25 seconds stale.
      if (holds.current > 0) return false;
      // A background tab does not need to be current, and a laptop full of them
      // should not be polling on the user's behalf.
      return document.visibilityState === 'visible';
    };

    /**
     * Whether a refresh would find anything — the cheap question, asked first.
     *
     * Answers true on anything it does not understand: no baseline to compare
     * against, a request that failed or timed out, a shape that is not what this
     * expects. Every one of those is the old unconditional behaviour, which is
     * the safe direction to be wrong in. Being wrong the other way is a portal
     * that has stopped telling anyone what is happening.
     */
    const somethingChanged = async (): Promise<boolean> => {
      if (renderedAt.current === null) return true;

      try {
        const res = await fetch('/api/portal/pulse', {
          cache: 'no-store',
          signal: AbortSignal.timeout(PULSE_TIMEOUT_MS),
        });
        if (!res.ok) return true;

        const { revision } = await res.json();
        if (typeof revision !== 'string') return true;
        return revision !== renderedAt.current;
      } catch {
        // Offline, aborted, or the server is unwell. router.refresh() is about
        // to fail too, harmlessly, and we will be back in twenty-five seconds.
        return true;
      }
    };

    async function tick() {
      try {
        if (shouldRefresh() && (await somethingChanged()) && !stopped) refresh();
      } finally {
        // Rearmed either way, and only after the decision — a held or hidden tab
        // keeps its place in the cycle instead of going quiet until something
        // re-mounts it. Arming after rather than before means one slow pulse
        // stretches a cycle; it never overlaps two.
        if (!stopped) arm();
      }
    }

    // Coming back to the tab is the moment somebody most wants it up to date —
    // and also the moment the pulse is most useful, because a tab left open over
    // lunch usually comes back to a portal where nothing has happened.
    const onVisibilityChange = async () => {
      if (!shouldRefresh()) return;
      // Mount counts as a refresh: the page in front of them is what the server
      // just rendered, so a return in the next few seconds has nothing to fetch.
      if (Date.now() - lastCheckAt.current < MIN_GAP_MS) return;
      // Claimed before the await, not after: without this, three quick returns
      // start three overlapping requests, all of which pass the check above
      // because none of them has refreshed yet.
      lastCheckAt.current = Date.now();

      if (!(await somethingChanged()) || stopped) return;
      refresh();
      // The countdown starts from the refresh that just happened, or a return
      // landing late in the cycle would be followed by another one moments
      // later.
      clearTimeout(timer);
      arm();
    };

    arm();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [router]);

  return (
    <RefreshContext.Provider value={{ hold, refreshNow }}>{children}</RefreshContext.Provider>
  );
}

/**
 * Pause the portal poll while `active` — an open modal, a panel someone is
 * reading. Ref-counted, so two things holding at once both have to let go.
 */
export function useRefreshHold(active: boolean): void {
  const { hold } = useContext(RefreshContext);
  useEffect(() => {
    if (!active) return;
    return hold();
  }, [active, hold]);
}

export function usePortalRefresh(): RefreshApi {
  return useContext(RefreshContext);
}

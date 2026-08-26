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

export function PortalRefresh({ children }: { children: React.ReactNode }) {
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

  const refreshNow = useCallback(() => router.refresh(), [router]);

  useEffect(() => {
    const refreshIfIdle = () => {
      // Held while a modal is open: re-rendering underneath someone who is
      // mid-way through copying a link is worse than being 25 seconds stale.
      if (holds.current > 0) return;
      // A background tab does not need to be current, and a laptop full of them
      // should not be polling on the user's behalf.
      if (document.visibilityState === 'visible') router.refresh();
    };

    const timer = setInterval(refreshIfIdle, REFRESH_MS);
    // Coming back to the tab is the moment somebody most wants it up to date.
    document.addEventListener('visibilitychange', refreshIfIdle);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfIdle);
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

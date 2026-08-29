import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalRefresh, usePortalRefresh, useRefreshHold } from '@/components/PortalRefresh';

// Hoisted so every useRouter() in a test hands back the same spy — a fresh
// vi.fn() per call would count nothing.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

/** The base interval and the jitter band around it, from the component. */
const BASE_MS = 25_000;
const SOONEST_MS = 21_250;
const LATEST_MS = 28_750;

let visibility: DocumentVisibilityState = 'visible';

/** What /api/portal/pulse will answer with next. */
let pulseReply: () => Promise<unknown> = async () => ({ revision: 'r1' });
const pulseFetch = vi.fn(() => pulseReply());

/** The Refresh button's path, reached from outside the tree. */
let pressRefresh: () => void = () => {};

function Poll({ held = false, pulse = 'r1' }: { held?: boolean; pulse?: string | null }) {
  return (
    <PortalRefresh pulse={pulse}>
      <Held active={held} />
    </PortalRefresh>
  );
}

function Held({ active }: { active: boolean }) {
  useRefreshHold(active);
  pressRefresh = usePortalRefresh().refreshNow;
  return null;
}

/**
 * Advances the clock and lets the pulse request and everything waiting on it
 * settle. The tick is async now, so draining timers alone proves nothing.
 */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function returnToTab() {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Answers the pulse with `revision`, as the route handler would. */
function pulseSays(revision: string | null) {
  pulseReply = async () => ({ revision });
}

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  vi.useFakeTimers();
  refresh.mockClear();
  pulseFetch.mockClear();
  pulseSays('r1');
  vi.stubGlobal('fetch', () => {
    pulseFetch();
    return Promise.resolve({ ok: true, json: () => pulseReply() } as unknown as Response);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PortalRefresh scheduling', () => {
  it('polls on the base interval when the jitter draws the middle', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    pulseSays('moved');
    render(<Poll />);

    await tick(BASE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();

    await tick(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('spreads tabs that were opened together across the window', async () => {
    // The case this exists for: a deploy or a restart sends every open portal
    // to the same page within a second or two. On a fixed interval their polls
    // would then land in the same moment forever.
    const random = vi.spyOn(Math, 'random');
    pulseSays('moved');

    random.mockReturnValueOnce(0);
    render(<Poll />);
    random.mockReturnValueOnce(1);
    render(<Poll />);

    await tick(SOONEST_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    await tick(LATEST_MS - SOONEST_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not poll a background tab, and does not lose its place either', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    pulseSays('moved');
    render(<Poll />);

    visibility = 'hidden';
    await tick(BASE_MS);
    expect(refresh).not.toHaveBeenCalled();
    expect(pulseFetch).not.toHaveBeenCalled();

    // Rearmed while hidden, so coming back does not mean waiting for something
    // to re-mount the timer.
    visibility = 'visible';
    await tick(BASE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not poll while something is holding the screen still', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    pulseSays('moved');
    render(<Poll held />);

    await tick(BASE_MS);
    expect(refresh).not.toHaveBeenCalled();
    expect(pulseFetch).not.toHaveBeenCalled();
  });

  it('refreshes on return to the tab, but not for a burst of tab-switching', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    pulseSays('moved');
    render(<Poll />);

    // The page in front of them is what the server just rendered.
    await returnToTab();
    expect(refresh).not.toHaveBeenCalled();

    await tick(10_000);
    await returnToTab();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Alt-tabbing away and straight back is not a second read.
    await tick(1_000);
    await returnToTab();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('counts a manual Refresh, so returning to the tab does not read again', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    pulseSays('moved');
    render(<Poll />);

    await tick(15_000);
    act(() => pressRefresh());
    expect(refresh).toHaveBeenCalledTimes(1);

    // Pressing Refresh and then switching tabs is one read, not two.
    await tick(1_000);
    await returnToTab();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never blocks a manual Refresh, however recently one happened', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<Poll />);

    // A button that quietly does nothing reads as broken — and it does not stop
    // to ask the pulse either.
    act(() => pressRefresh());
    act(() => pressRefresh());
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(pulseFetch).not.toHaveBeenCalled();
  });
});

describe('PortalRefresh change detection', () => {
  it('asks the pulse first and skips the refresh when nothing has moved', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    pulseSays('r1'); // the same revision the page was rendered at
    render(<Poll pulse="r1" />);

    await tick(BASE_MS);
    expect(pulseFetch).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();

    // And it keeps asking rather than giving up after the first quiet tick.
    await tick(BASE_MS);
    expect(pulseFetch).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes as soon as the revision moves', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<Poll pulse="r1" />);

    await tick(BASE_MS);
    expect(refresh).not.toHaveBeenCalled();

    pulseSays('r2');
    await tick(BASE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('takes its baseline from the render, not from the last pulse it fetched', async () => {
    // A refresh that never lands — offline, or a navigation cancelling it —
    // leaves the page on r1. Adopting the fetched r2 as the new baseline would
    // strand it there permanently.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    pulseSays('r2');
    render(<Poll pulse="r1" />);

    await tick(BASE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The prop is still r1, because the render never happened.
    await tick(BASE_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('refreshes unconditionally when the server could not read the pulse', async () => {
    // An app deployed ahead of its migration must behave exactly as it did
    // before any of this existed.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<Poll pulse={null} />);

    await tick(BASE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    // And it does not waste a request asking a question it cannot use.
    expect(pulseFetch).not.toHaveBeenCalled();
  });

  it('refreshes when the pulse request fails', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<Poll pulse="r1" />);
    vi.stubGlobal('fetch', () => {
      pulseFetch();
      return Promise.reject(new Error('offline'));
    });

    await tick(BASE_MS);
    expect(pulseFetch).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the server answers that it could not read the pulse', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    pulseSays(null);
    render(<Poll pulse="r1" />);

    await tick(BASE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes on a non-OK response rather than assuming nothing changed', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<Poll pulse="r1" />);
    vi.stubGlobal('fetch', () => {
      pulseFetch();
      return Promise.resolve({ ok: false, json: async () => ({}) } as unknown as Response);
    });

    await tick(BASE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('spends one small request instead of a refresh on a quiet tab return', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    pulseSays('r1');
    render(<Poll pulse="r1" />);

    await tick(11_000);
    await returnToTab();
    expect(pulseFetch).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

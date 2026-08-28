import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsProvider, useMaps } from '@/components/MapsProvider';

const toast = vi.fn();

vi.mock('@/components/Toast', () => ({
  useToast: () => toast,
}));

const SCRIPT_ID = 'somo-gmaps-script';

/** Renders what a consumer sees, so both flags can be asserted from outside. */
function Probe() {
  const maps = useMaps();
  return (
    <span data-testid="state">
      {`${maps.ready ? 'core' : 'no-core'}/${maps.placesReady ? 'places' : 'no-places'}`}
    </span>
  );
}

function state(): string {
  return screen.getByTestId('state').textContent ?? '';
}

function script(): HTMLScriptElement | null {
  return document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
}

/**
 * The core namespace, which is what `loading=async` puts up first: Geocoder and
 * Distance Matrix are here, Places is not. `importLibrary` never settles, the
 * way it looks while the library is still in flight.
 */
function coreArrives() {
  (window as unknown as { google: unknown }).google = {
    maps: {
      Geocoder: class {},
      DistanceMatrixService: class {},
      importLibrary: () => new Promise(() => {}),
    },
  };
}

/** The places library landing afterwards, however it finds its way in. */
function placesArrives() {
  const g = (window as unknown as { google: { maps: Record<string, unknown> } }).google;
  g.maps.places = { Autocomplete: class {} };
}

beforeEach(() => {
  toast.mockClear();
});

afterEach(() => {
  delete (window as unknown as { google?: unknown }).google;
  script()?.remove();
});

describe('MapsProvider readiness', () => {
  it('reports the core SDK as soon as it lands, without waiting for places', async () => {
    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );

    expect(state()).toBe('no-core/no-places');

    coreArrives();

    // The location button and Get from Maps only ever needed this much, so this
    // is where they start working — not when Places eventually turns up.
    await waitFor(() => expect(state()).toBe('core/no-places'));
  });

  it('reports places separately, whenever it arrives', async () => {
    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );

    coreArrives();
    await waitFor(() => expect(state()).toBe('core/no-places'));

    placesArrives();
    await waitFor(() => expect(state()).toBe('core/places'));
  });

  /**
   * The regression that made the first attempt at this worse than the bug. A
   * one-shot check of the namespace, run at the script's load event, threw when
   * Places had not landed yet — which showed a merchant an API-key error on a
   * perfectly good key, and left `ready` false so the location button fell back
   * to writing bare coordinates.
   */
  it('does not blame the API key while places is merely slow', async () => {
    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );

    coreArrives();
    await waitFor(() => expect(state()).toBe('core/no-places'));

    // Several more polls with no places in sight.
    await new Promise((r) => setTimeout(r, 300));

    expect(state()).toBe('core/no-places');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Google Maps connected');
  });

  /**
   * A remount after the script has finished loading. Waiting on the `load`
   * event here would wait for one that already fired and never come up.
   */
  it('picks up an SDK already in the page from an earlier navigation', async () => {
    coreArrives();
    placesArrives();

    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );

    await waitFor(() => expect(state()).toBe('core/places'));
    // Nothing to fetch — it is already here.
    expect(script()).toBeNull();
  });

  it('says so when the script itself never arrives', async () => {
    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );

    script()?.dispatchEvent(new Event('error'));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.stringContaining('Could not load Google Maps'),
        'danger'
      )
    );
  });

  it('loads nothing at all without a key', () => {
    render(
      <MapsProvider mapsApiKey="">
        <Probe />
      </MapsProvider>
    );

    expect(script()).toBeNull();
    expect(state()).toBe('no-core/no-places');
    expect(toast).not.toHaveBeenCalled();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsProvider, useMaps } from '@/components/MapsProvider';

const toast = vi.fn();

vi.mock('@/components/Toast', () => ({
  useToast: () => toast,
}));

const SCRIPT_ID = 'somo-gmaps-script';

/** Renders what a consumer sees, so `ready` can be asserted from the outside. */
function Probe() {
  const maps = useMaps();
  return <span data-testid="state">{maps.ready ? 'ready' : 'waiting'}</span>;
}

function state(): string {
  return screen.getByTestId('state').textContent ?? '';
}

function script(): HTMLScriptElement | null {
  return document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
}

/**
 * What the bootstrap script's `load` event actually leaves behind under
 * `loading=async`: the core namespace, and an importLibrary that has not
 * resolved yet. Geocoder and DistanceMatrixService are here; `places` is not.
 */
function bootstrapLoads() {
  let settle: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    settle = resolve;
  });

  (window as unknown as { google: unknown }).google = {
    maps: {
      importLibrary: () => pending,
      Geocoder: class {},
      DistanceMatrixService: class {},
    },
  };
  script()?.dispatchEvent(new Event('load'));

  /** The places library finishing, the way importLibrary reports it. */
  return function placesArrives() {
    const g = (window as unknown as { google: { maps: Record<string, unknown> } }).google;
    g.maps.places = { Autocomplete: class {} };
    settle();
  };
}

beforeEach(() => {
  toast.mockClear();
});

afterEach(() => {
  delete (window as unknown as { google?: unknown }).google;
  script()?.remove();
});

describe('MapsProvider readiness', () => {
  /**
   * The bug this guards. `ready` is read inside effects that bind once and are
   * never re-run — the New delivery form's address autocomplete is one — so
   * announcing the SDK while `google.maps.places` is still in flight means those
   * effects bind nothing and never get another chance. What a merchant saw: the
   * location button filled the pickup (Geocoder is core, so it was up) and the
   * drop-off field suggested nothing until the page was left and revisited.
   */
  it('does not report ready while the places library is still loading', async () => {
    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );

    expect(state()).toBe('waiting');

    const placesArrives = bootstrapLoads();
    // The load event has fired and the core namespace is up. Still not enough.
    await waitFor(() => expect(state()).toBe('waiting'));

    placesArrives();
    await waitFor(() => expect(state()).toBe('ready'));
  });

  it('announces the connection once, when the SDK is actually usable', async () => {
    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );

    const placesArrives = bootstrapLoads();
    expect(toast).not.toHaveBeenCalled();

    placesArrives();
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Google Maps connected'));
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('says so plainly when the places library never arrives', async () => {
    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );

    // Resolves without ever populating `places` — an API key with Places not
    // enabled on it behaves this way.
    (window as unknown as { google: unknown }).google = {
      maps: { importLibrary: () => Promise.resolve({}) },
    };
    script()?.dispatchEvent(new Event('load'));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('Could not load Google Maps'), 'danger')
    );
    expect(state()).toBe('waiting');
  });

  /**
   * A provider that mounts while an earlier mount's script is still in flight
   * used to return early and stay `waiting` for good: nothing was listening for
   * that script's load event.
   */
  it('waits on a script an earlier mount injected rather than giving up on it', async () => {
    const first = render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );
    expect(script()).not.toBeNull();
    first.unmount();

    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );
    expect(state()).toBe('waiting');

    const placesArrives = bootstrapLoads();
    placesArrives();

    await waitFor(() => expect(state()).toBe('ready'));
  });

  it('reports ready straight away when the SDK is already loaded', async () => {
    (window as unknown as { google: unknown }).google = {
      maps: {
        importLibrary: () => Promise.resolve({}),
        places: { Autocomplete: class {} },
      },
    };

    render(
      <MapsProvider mapsApiKey="test-key">
        <Probe />
      </MapsProvider>
    );

    await waitFor(() => expect(state()).toBe('ready'));
  });

  it('injects nothing and stays unconfigured without a key', () => {
    render(
      <MapsProvider mapsApiKey="">
        <Probe />
      </MapsProvider>
    );

    expect(script()).toBeNull();
    expect(state()).toBe('waiting');
  });
});

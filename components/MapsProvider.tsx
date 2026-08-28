'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';

/**
 * Loads the Google Maps JavaScript SDK once per session and exposes whether it
 * is usable. The key is handed down from the authenticated portal layout, so it
 * is never served to an anonymous visitor — but it does still reach every
 * signed-in browser, because Maps JS has to run client-side. Restrict the key by
 * HTTP referrer in Google Cloud Console.
 */
interface MapsState {
  /**
   * True once Places and Distance Matrix can actually be called — not merely
   * once the bootstrap script has loaded. Consumers bind to this in effects and
   * get no second chance, so it has to mean the whole SDK is usable.
   */
  ready: boolean;
  /** True when an admin has saved a key at all. */
  configured: boolean;
}

const MapsContext = createContext<MapsState>({ ready: false, configured: false });

const SCRIPT_ID = 'somo-gmaps-script';

export function MapsProvider({
  mapsApiKey,
  children,
}: {
  mapsApiKey: string;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const toast = useToast();
  const announced = useRef(false);

  useEffect(() => {
    if (!mapsApiKey) return;
    let live = true;

    /**
     * Announces the SDK only once Places can actually be called.
     *
     * The script's `load` event is not that moment. `loading=async` splits the
     * bootstrap from the libraries it pulls in: `onload` fires when the
     * bootstrap has run, which populates the core namespace — Geocoder,
     * DistanceMatrixService — while `places` is still in flight. Reporting
     * ready there is what produced the bug this guard exists for: the New
     * delivery form binds its address autocomplete in an effect keyed on
     * `ready`, found no `google.maps.places`, did nothing, and never ran
     * again, because `ready` does not change a second time. The result was a
     * form where the location button filled the pickup perfectly — Geocoder is
     * core, so it was up — and the drop-off field simply never suggested
     * anything until the page was left and revisited.
     *
     * `importLibrary` is the documented signal and resolves when the library is
     * genuinely usable. It also adds itself to the global namespace on the way,
     * which is what the callers read.
     */
    async function announceWhenUsable() {
      try {
        // Bootstraps predating importLibrary populate `places` directly, so a
        // missing importLibrary is not a failure on its own.
        if (window.google?.maps?.importLibrary) {
          await window.google.maps.importLibrary('places');
        }
        if (!live) return;
        if (!window.google?.maps?.places) throw new Error('Places library did not load');
        setReady(true);
        if (!announced.current) {
          announced.current = true;
          toast('Google Maps connected');
        }
      } catch {
        if (live) toast('Could not load Google Maps — check the API key in Settings', 'danger');
      }
    }

    // Already in the page from an earlier navigation in this session. Possibly
    // only partway there — the core namespace can be up with `places` still
    // loading — which is exactly what announceWhenUsable is for.
    if (window.google?.maps) {
      announceWhenUsable();
      return () => {
        live = false;
      };
    }

    // Injected by an earlier mount and still in flight. Wait on it rather than
    // assuming it finished: returning outright, as this used to, left `ready`
    // false for the whole life of a provider that remounted mid-load.
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', announceWhenUsable, { once: true });
      return () => {
        live = false;
        existing.removeEventListener('load', announceWhenUsable);
      };
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src =
      'https://maps.googleapis.com/maps/api/js?libraries=places&loading=async&key=' +
      encodeURIComponent(mapsApiKey);
    script.onload = announceWhenUsable;
    script.onerror = () => {
      toast('Could not load Google Maps — check the API key in Settings', 'danger');
      script.remove();
    };
    document.head.appendChild(script);

    return () => {
      live = false;
    };
  }, [mapsApiKey, toast]);

  return (
    <MapsContext.Provider value={{ ready, configured: !!mapsApiKey }}>
      {children}
    </MapsContext.Provider>
  );
}

export function useMaps(): MapsState {
  return useContext(MapsContext);
}

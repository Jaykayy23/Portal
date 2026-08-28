'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';

/**
 * Loads the Google Maps JavaScript SDK once per session and exposes what of it
 * is usable. The key is handed down from the authenticated portal layout, so it
 * is never served to an anonymous visitor — but it does still reach every
 * signed-in browser, because Maps JS has to run client-side. Restrict the key by
 * HTTP referrer in Google Cloud Console.
 */
interface MapsState {
  /**
   * True once the core SDK is callable: Geocoder and Distance Matrix.
   *
   * Deliberately not "the whole SDK is up". Under `loading=async` the core
   * namespace and the Places library arrive at different moments, and the
   * location button has no reason to wait for Places — gating it on Places is
   * what would leave it writing bare coordinates while Places is still coming.
   */
  ready: boolean;
  /** True once Places is callable, which is what address autocomplete needs. */
  placesReady: boolean;
  /** True when an admin has saved a key at all. */
  configured: boolean;
}

const MapsContext = createContext<MapsState>({
  ready: false,
  placesReady: false,
  configured: false,
});

const SCRIPT_ID = 'somo-gmaps-script';

/** How often to look again for a library that has not landed yet. */
const POLL_MS = 100;

/**
 * How long to keep looking before leaving the form to manual entry.
 *
 * Long enough for a slow roadside connection to finish fetching a library,
 * short enough that the polling does not run for the life of the page.
 */
const LIBRARY_TIMEOUT_MS = 20000;

export function MapsProvider({
  mapsApiKey,
  children,
}: {
  mapsApiKey: string;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [placesReady, setPlacesReady] = useState(false);
  const toast = useToast();
  const announced = useRef(false);

  useEffect(() => {
    if (!mapsApiKey) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let requestedPlaces = false;
    let sawCore = false;
    let sawPlaces = false;
    const deadline = Date.now() + LIBRARY_TIMEOUT_MS;

    /**
     * Watches for each library and announces it the moment it can be called.
     *
     * Polling, rather than reading the namespace once when the script's `load`
     * event fires. `loading=async` splits the bootstrap from the libraries it
     * pulls in, so what exists at that one instant varies with the connection —
     * and a check that runs a moment too early gets no second chance, because
     * these flags only ever go true once and the effects reading them bind
     * once. That is the failure this shape exists to prevent: a form whose
     * location button worked, because Geocoder is core and was up, and whose
     * drop-off field suggested nothing until the page was left and revisited.
     */
    function poll() {
      if (cancelled) return;
      const maps = window.google?.maps;

      // Asking for Places is the documented way to pull it in, and it populates
      // the namespace the callers read on its way. It is a nudge, not the
      // signal: the checks below are what decide, so this settling either way
      // is never by itself reported as a broken key.
      if (!requestedPlaces && maps?.importLibrary) {
        requestedPlaces = true;
        maps.importLibrary('places').catch(() => {});
      }

      if (!sawCore && maps?.Geocoder && maps?.DistanceMatrixService) {
        sawCore = true;
        setReady(true);
        if (!announced.current) {
          announced.current = true;
          toast('Google Maps connected');
        }
      }

      if (!sawPlaces && maps?.places?.Autocomplete) {
        sawPlaces = true;
        setPlacesReady(true);
      }

      if (sawCore && sawPlaces) return;
      // Out of time. Whatever did arrive stays usable and the rest is typed by
      // hand — a library that is merely slow is not worth an error a merchant
      // can do nothing about, and least of all one blaming a key that is fine.
      if (Date.now() >= deadline) return;
      timer = setTimeout(poll, POLL_MS);
    }

    // Nothing in the page yet, so this mount is the one that fetches it. An
    // earlier mount or an earlier navigation in this session may have got there
    // first, and its script may be in flight or already done — the poll covers
    // both, where waiting on a `load` event would miss one that already fired.
    if (!document.getElementById(SCRIPT_ID) && !window.google?.maps) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.async = true;
      script.src =
        'https://maps.googleapis.com/maps/api/js?libraries=places&loading=async&key=' +
        encodeURIComponent(mapsApiKey);
      // The script itself never arriving is the one failure worth a message:
      // blocked, offline, or a key so wrong the request is refused outright.
      // Everything softer than that is left to the poll and its deadline.
      script.onerror = () => {
        if (!cancelled) {
          toast('Could not load Google Maps — check the API key in Settings', 'danger');
        }
        script.remove();
      };
      document.head.appendChild(script);
    }

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [mapsApiKey, toast]);

  return (
    <MapsContext.Provider value={{ ready, placesReady, configured: !!mapsApiKey }}>
      {children}
    </MapsContext.Provider>
  );
}

export function useMaps(): MapsState {
  return useContext(MapsContext);
}

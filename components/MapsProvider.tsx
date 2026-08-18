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
  /** True once the SDK has loaded and Places/Distance Matrix can be called. */
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

    // Already loaded by an earlier navigation in this session.
    if (window.google?.maps?.places) {
      setReady(true);
      return;
    }
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src =
      'https://maps.googleapis.com/maps/api/js?libraries=places&loading=async&key=' +
      encodeURIComponent(mapsApiKey);
    script.onload = () => {
      setReady(true);
      if (!announced.current) {
        announced.current = true;
        toast('Google Maps connected');
      }
    };
    script.onerror = () => {
      toast('Could not load Google Maps — check the API key in Settings');
      script.remove();
    };
    document.head.appendChild(script);
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

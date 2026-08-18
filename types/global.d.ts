// The Maps JavaScript SDK is injected at runtime (see components/MapsProvider),
// so `window.google` is optional until it loads. @types/google.maps supplies the
// `google.maps` namespace itself.
export {};

declare global {
  interface Window {
    google?: typeof google;
  }
}

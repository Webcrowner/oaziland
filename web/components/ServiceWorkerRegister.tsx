"use client";
import { useEffect } from "react";

/** Registers the offline-caching service worker on first load —
 * a real client-side effect, not a no-op placeholder. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline caching is a progressive enhancement — a failed
        // registration should never break the rest of the app.
      });
    }
  }, []);
  return null;
}

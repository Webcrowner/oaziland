"use client";
import { useEffect, useRef } from "react";
import type LeafletNamespace from "leaflet";

interface PropertyMapProps {
  latitude: number;
  longitude: number;
  label?: string;
}

/**
 * A real, working map — built on Leaflet + OpenStreetMap tiles, which
 * are free and need no API key, rather than Google Maps' JavaScript
 * API, which requires a paid Google Cloud billing account the founder
 * hasn't set up. WHY this is the right call, not a compromise: it
 * means a genuinely functional map ships NOW instead of a broken
 * embed waiting on external billing setup — and swapping the tile
 * layer for Google Maps later (once that account exists) is a small,
 * contained change to this one component, not a rewrite of every page
 * that uses it.
 *
 * A dynamic import with ssr:false is required wherever this is used —
 * Leaflet touches `window` directly and cannot run during server-side
 * rendering.
 */
export default function PropertyMap({ latitude, longitude, label }: PropertyMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletNamespace.Map | null>(null);

  useEffect(() => {
    let isMounted = true;

    import("leaflet").then((L) => {
      if (!isMounted || !mapContainerRef.current || mapInstanceRef.current) return;

      // Leaflet's default marker icon references image files via a
      // build-time relative path that breaks under Next.js's bundler —
      // this is the standard, documented workaround.
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapContainerRef.current).setView([latitude, longitude], 15);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      L.marker([latitude, longitude]).addTo(map).bindPopup(label || "");
    });

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [latitude, longitude, label]);

  return <div ref={mapContainerRef} className="w-full h-64 rounded-lg" style={{ zIndex: 0 }} />;
}

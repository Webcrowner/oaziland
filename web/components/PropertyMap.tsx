"use client";
import { useEffect, useRef } from "react";
import type LeafletNamespace from "leaflet";

interface PropertyMapProps {
  latitude: number;
  longitude: number;
  label?: string;
  showGoogleMapsButton?: boolean;
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
export default function PropertyMap({
  latitude,
  longitude,
  label,
  showGoogleMapsButton = true,
}: PropertyMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletNamespace.Map | null>(null);

  const googleMapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const googleMapsPinUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

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

      const safeLabel = (label || "Property Location").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      const popupHtml = `
        <div style="font-family: inherit; padding: 2px;">
          <p style="font-weight: 700; margin: 0 0 4px; color: #0f172a; font-size: 13px;">${safeLabel}</p>
          <p style="margin: 0 0 8px; color: #64748b; font-size: 11px;">GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}</p>
          <a href="${googleMapsDirectionsUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: #f59e0b; color: #020617; font-weight: 700; font-size: 11px; padding: 4px 8px; border-radius: 6px; text-decoration: none;">
            Open in Google Maps &amp; Follow
          </a>
        </div>
      `;

      L.marker([latitude, longitude]).addTo(map).bindPopup(popupHtml);
    });

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [latitude, longitude, label, googleMapsDirectionsUrl]);

  return (
    <div className="relative group/map w-full rounded-2xl overflow-hidden border border-slate-200 shadow-xs bg-slate-50">
      <div ref={mapContainerRef} className="w-full h-72" style={{ zIndex: 0 }} />

      {showGoogleMapsButton && (
        <div className="p-3 bg-white border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span>GPS: {latitude.toFixed(5)}, {longitude.toFixed(5)}</span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={googleMapsPinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <span>View Pin</span>
            </a>

            <a
              href={googleMapsDirectionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-all shadow-xs active:scale-95"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
              <span>Open in Google Maps &amp; Follow</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

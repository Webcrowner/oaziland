"use client";
import { useEffect, useRef, useState } from "react";
import type LeafletNamespace from "leaflet";
import type { FeedItem } from "@/lib/useMarketplaceListings";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Every loaded marketplace listing that has a map position, as pins with a small popup linking to the listing.
 * Listings without coordinates are never plotted at a made-up place. Built on Leaflet + OpenStreetMap like
 * the property maps, so it needs no API key; load it with `dynamic(..., { ssr: false })` since Leaflet uses `window`.
 */
export default function MarketplaceMap({
  listings, locale, viewer,
}: {
  listings: FeedItem[];
  locale: string;
  /** The searcher's own position, drawn as a blue dot when "near me" is on. */
  viewer?: { latitude: number; longitude: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNamespace.Map | null>(null);
  const layerRef = useRef<LeafletNamespace.LayerGroup | null>(null);
  const leafletRef = useRef<typeof LeafletNamespace | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    import("leaflet").then((L) => {
      if (!mounted || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current).setView([3.848, 11.5021], 11); // Yaoundé until pins arrive
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      setReady(true);
    });
    return () => {
      mounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  const viewerLat = viewer?.latitude;
  const viewerLng = viewer?.longitude;
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!ready || !L || !map || !layer) return;
    layer.clearLayers();

    const points: [number, number][] = [];
    for (const listing of listings) {
      if (listing.latitude == null || listing.longitude == null) continue;
      const point: [number, number] = [Number(listing.latitude), Number(listing.longitude)];
      points.push(point);
      const price = `${Number(listing.price_xaf).toLocaleString()} XAF`;
      const href = `/${locale}/marketplace/${listing.category}/${listing.id}`;
      L.circleMarker(point, { radius: 9, fillColor: "#C9A227", color: "#1B2A4A", weight: 2, fillOpacity: 0.9 })
        .bindPopup(
          `<div style="font-family:inherit"><p style="margin:0 0 2px;font-weight:700;color:#1B2A4A">${escapeHtml(price)}</p>`
          + `<a href="${escapeHtml(href)}" style="color:#0f172a;font-size:13px">${escapeHtml(listing.title)}</a></div>`,
        )
        .addTo(layer);
    }
    if (viewerLat !== undefined && viewerLng !== undefined && !Number.isNaN(viewerLat)) {
      points.push([viewerLat, viewerLng]);
      L.circleMarker([viewerLat, viewerLng], { radius: 7, fillColor: "#2563eb", color: "#ffffff", weight: 3, fillOpacity: 1 }).addTo(layer);
    }
    if (points.length > 0) map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  }, [ready, listings, locale, viewerLat, viewerLng]);

  return <div ref={containerRef} className="h-[28rem] w-full rounded-2xl border border-slate-200 bg-slate-50" style={{ zIndex: 0 }} role="region" aria-label="Map" />;
}

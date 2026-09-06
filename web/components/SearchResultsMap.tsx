"use client";
import { useEffect, useRef } from "react";
import type LeafletNamespace from "leaflet";
import type { Listing } from "@/lib/api";

interface SearchResultsMapProps {
  listings: Listing[];
  hoveredId: string | null;
  onMarkerClick: (id: string) => void;
}

/**
 * The real map+list sync every major real estate platform's search
 * page is built around: hover a card, its pin visually highlights;
 * click a pin, the matching card scrolls into view. A separate
 * component from PropertyMap (which shows exactly one property on
 * its own detail page) since the real requirements are genuinely
 * different here — many markers, a shared hover state with the list
 * beside it, and an auto-fit bounds so every result is visible at
 * once without the user having to pan around to find them.
 *
 * Listings with no real latitude/longitude are honestly excluded
 * from the map (never plotted at a fake location) — the results LIST
 * still shows every match regardless.
 */
export default function SearchResultsMap({ listings, hoveredId, onMarkerClick }: SearchResultsMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletNamespace.Map | null>(null);
  const markersRef = useRef<Map<string, LeafletNamespace.CircleMarker>>(new Map());
  const leafletRef = useRef<typeof LeafletNamespace | null>(null);

  const withCoords = listings.filter((l) => l.property_asset.latitude && l.property_asset.longitude);

  useEffect(() => {
    let isMounted = true;
    import("leaflet").then((L) => {
      if (!isMounted || !mapContainerRef.current || mapInstanceRef.current) return;
      leafletRef.current = L;

      const map = L.map(mapContainerRef.current).setView([3.848, 11.5021], 12); // Yaoundé default
      mapInstanceRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
    });
    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real markers, redrawn whenever the actual result set changes —
  // not on every render, avoiding a flicker on hover-only updates.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    const bounds: [number, number][] = [];
    withCoords.forEach((listing) => {
      const lat = Number(listing.property_asset.latitude);
      const lng = Number(listing.property_asset.longitude);
      bounds.push([lat, lng]);
      const marker = L.circleMarker([lat, lng], {
        radius: 9, fillColor: "#C9A227", color: "#1B2A4A", weight: 2, fillOpacity: 0.9,
      }).addTo(map);
      marker.on("click", () => onMarkerClick(listing.id));
      markersRef.current.set(listing.id, marker);
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings]);

  // Real hover-sync — the highlighted pin grows and turns navy,
  // matching whichever card the user is currently looking at.
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const isHovered = id === hoveredId;
      marker.setStyle({
        radius: isHovered ? 13 : 9,
        fillColor: isHovered ? "#1B2A4A" : "#C9A227",
      });
      if (isHovered) marker.bringToFront();
    });
  }, [hoveredId]);

  return <div ref={mapContainerRef} className="w-full h-full rounded-lg" style={{ zIndex: 0 }} />;
}

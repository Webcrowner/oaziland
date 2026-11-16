"use client";
import { useEffect, useRef } from "react";
import type LeafletNamespace from "leaflet";
import { decodePolyline } from "./route";

type Point = [number, number];

/**
 * The trip on a map before booking: pickup (green), drop-off (red) and the road route from the quote.
 * When the route is only an estimate there's no road line, so a dashed straight line joins the two points.
 */
export default function RouteMap({ pickup, dropoff, polyline, label }: { pickup: Point; dropoff: Point; polyline: string; label: string }) {
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNamespace.Map | null>(null);
  const layerRef = useRef<LeafletNamespace.LayerGroup | null>(null);
  const leafletRef = useRef<typeof LeafletNamespace | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !mapElRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapElRef.current, { zoomControl: true, scrollWheelZoom: false });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      draw();
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // Created once; route changes are drawn by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const road = polyline ? decodePolyline(polyline) : [];
    const line = road.length > 1 ? road : [pickup, dropoff];
    L.polyline(line, road.length > 1 ? { color: "#0f172a", weight: 5, opacity: 0.85 } : { color: "#64748b", weight: 3, dashArray: "6 8" }).addTo(layer);
    L.circleMarker(pickup, { radius: 8, color: "#047857", fillColor: "#10b981", fillOpacity: 1, weight: 3 }).addTo(layer);
    L.circleMarker(dropoff, { radius: 8, color: "#b91c1c", fillColor: "#ef4444", fillOpacity: 1, weight: 3 }).addTo(layer);
    map.fitBounds(L.latLngBounds([...line, pickup, dropoff]), { padding: [24, 24], maxZoom: 16 });
  }

  useEffect(draw, [pickup[0], pickup[1], dropoff[0], dropoff[1], polyline]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mapElRef} role="img" aria-label={label} className="h-56 w-full overflow-hidden rounded-xl border border-slate-200" style={{ zIndex: 0 }} />;
}

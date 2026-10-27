"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type LeafletNamespace from "leaflet";
import { getRideDriverLocation, type DriverTracking, type RideBookingItem } from "@/lib/api";
import { IconCar } from "@/components/Icons";

const POLL_MS = 8000;
const STALE_MS = 2 * 60 * 1000;

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** Follows the driver's car on a map, with distance and arrival estimate, refreshed every few seconds. */
export default function DriverTrackingMap({ ride }: { ride: RideBookingItem }) {
  const t = useTranslations("OaziGoPage");
  const [tracking, setTracking] = useState<DriverTracking | null>(null);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNamespace.Map | null>(null);
  const leafletRef = useRef<typeof LeafletNamespace | null>(null);
  const carRef = useRef<LeafletNamespace.Marker | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const token = localStorage.getItem("access_token");
      if (!token) return;
      try {
        const data = await getRideDriverLocation(ride.id, token);
        if (!cancelled) {
          setTracking(data);
          setStale(data.updated_at ? Date.now() - new Date(data.updated_at).getTime() > STALE_MS : false);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [ride.id]);

  const lat = num(tracking?.latitude);
  const lon = num(tracking?.longitude);
  const located = Boolean(tracking?.located) && lat !== null && lon !== null;

  // Map appears once the first position arrives, and is torn down with the card.
  useEffect(() => {
    if (!located) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !mapElRef.current || mapRef.current) return;
      leafletRef.current = L;
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      const map = L.map(mapElRef.current).setView([lat!, lon!], 15);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      const target = tracking?.heading_to === "dropoff"
        ? [num(ride.dropoff_latitude), num(ride.dropoff_longitude)]
        : [num(ride.pickup_latitude), num(ride.pickup_longitude)];
      if (target[0] !== null && target[1] !== null) {
        L.circleMarker([target[0], target[1]], { radius: 9, color: "#047857", fillColor: "#10b981", fillOpacity: 0.9 }).addTo(map);
      }
      carRef.current = L.marker([lat!, lon!]).addTo(map);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      carRef.current = null;
      fittedRef.current = false;
    };
    // The map is created once; position changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located]);

  useEffect(() => {
    if (!located || !mapRef.current || !carRef.current) return;
    carRef.current.setLatLng([lat!, lon!]);
    if (!fittedRef.current) { mapRef.current.setView([lat!, lon!], 15); fittedRef.current = true; }
    else mapRef.current.panTo([lat!, lon!]);
  }, [located, lat, lon]);

  const headingTo = tracking?.heading_to === "dropoff" ? t("trackingToDropoff") : t("trackingToPickup");

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5">
      <p className="flex items-center gap-2 text-sm font-bold text-emerald-900">
        <IconCar size={16} className="shrink-0" />
        {located && tracking?.eta_minutes
          ? t("trackingEta", { minutes: tracking.eta_minutes, km: tracking.distance_km ?? "", target: headingTo })
          : located
            ? t("trackingLive")
            : failed ? t("trackingUnavailable") : t("trackingWaiting")}
      </p>
      {stale && located && <p className="mt-1 text-[11px] text-amber-700">{t("trackingStale")}</p>}
      {located && <div ref={mapElRef} className="mt-3 h-56 w-full overflow-hidden rounded-xl border border-emerald-200" style={{ zIndex: 0 }} />}
    </div>
  );
}

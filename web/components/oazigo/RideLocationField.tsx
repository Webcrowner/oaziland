"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type LeafletNamespace from "leaflet";
import { IconMapPin } from "@/components/Icons";
import { inputCls, labelCls } from "./styles";

export type Coords = { latitude: number | null; longitude: number | null };

interface Suggestion {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface Props {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onValueChange: (text: string) => void;
  coords: Coords;
  onCoordsChange: (coords: Coords) => void;
  /** Offers a "use my current location" shortcut (pickup only). */
  allowCurrentLocation?: boolean;
}

// Centre of Yaoundé, used until a point is chosen.
const DEFAULT_CENTER: [number, number] = [3.848, 11.5021];

const hasPoint = (c: Coords) => c.latitude !== null && c.longitude !== null;
const round6 = (n: number) => Number(n.toFixed(6));

/**
 * A pickup/drop-off field that does not require the user to be at the
 * place: type to search Cameroon places (OpenStreetMap Nominatim), drop
 * a pin on the map, or — for pickup — use the current location.
 */
export default function RideLocationField({
  id, label, placeholder, value, onValueChange, coords, onCoordsChange, allowCurrentLocation = false,
}: Props) {
  const t = useTranslations("OaziGoPage");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [typed, setTyped] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNamespace.Map | null>(null);
  const markerRef = useRef<LeafletNamespace.Marker | null>(null);
  const onCoordsRef = useRef(onCoordsChange);
  const onValueRef = useRef(onValueChange);
  const valueRef = useRef(value);
  useEffect(() => {
    onCoordsRef.current = onCoordsChange;
    onValueRef.current = onValueChange;
    valueRef.current = value;
  });

  // Debounced place search while the user types.
  useEffect(() => {
    const query = value.trim();
    if (!typed || query.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=cm&limit=5&q=${encodeURIComponent(query)}`,
        { signal: controller.signal, headers: { "Accept-Language": document.documentElement.lang || "en" } },
      )
        .then((res) => (res.ok ? res.json() : []))
        .then((rows: Suggestion[]) => setSuggestions(rows))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, typed]);

  // Leaflet map, created only while the picker is open.
  useEffect(() => {
    if (!showMap) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !mapElRef.current || mapRef.current) return;
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      const start: [number, number] = hasPoint(coords) ? [coords.latitude!, coords.longitude!] : DEFAULT_CENTER;
      const map = L.map(mapElRef.current).setView(start, hasPoint(coords) ? 15 : 12);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      if (hasPoint(coords)) markerRef.current = L.marker(start).addTo(map);
      map.on("click", (e: LeafletNamespace.LeafletMouseEvent) => {
        if (markerRef.current) markerRef.current.setLatLng(e.latlng);
        else markerRef.current = L.marker(e.latlng).addTo(map);
        onCoordsRef.current({ latitude: round6(e.latlng.lat), longitude: round6(e.latlng.lng) });
        if (!valueRef.current.trim()) onValueRef.current(t("pinnedLocation"));
      });
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // The map is created once per open; later coordinate changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap]);

  // Keep the pin and view in sync when coordinates change from search or GPS.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasPoint(coords)) return;
    const point: [number, number] = [coords.latitude!, coords.longitude!];
    if (markerRef.current) markerRef.current.setLatLng(point);
    else import("leaflet").then((L) => { if (mapRef.current) markerRef.current = L.marker(point).addTo(mapRef.current); });
    map.setView(point, Math.max(map.getZoom(), 15));
  }, [coords]);

  function pick(s: Suggestion) {
    setTyped(false);
    setSuggestions([]);
    onValueChange(s.display_name.split(", ").slice(0, 3).join(", "));
    onCoordsChange({ latitude: round6(Number(s.lat)), longitude: round6(Number(s.lon)) });
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError(t("gpsUnsupported"));
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setTyped(false);
        setSuggestions([]);
        onCoordsChange({ latitude: round6(pos.coords.latitude), longitude: round6(pos.coords.longitude) });
        if (!value.trim()) onValueChange(t("currentLocation"));
      },
      () => {
        setLocating(false);
        setError(t("gpsDenied"));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  const chipCls =
    "inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-60";

  return (
    <div>
      <label className={labelCls} htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          required
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => { onValueChange(e.target.value); setTyped(true); if (e.target.value.trim().length < 3) setSuggestions([]); }}
          className={inputCls}
        />
        {typed && (searching || suggestions.length > 0) && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {searching && suggestions.length === 0 && <li className="px-3.5 py-2.5 text-xs text-slate-400">{t("searchingPlaces")}</li>}
            {suggestions.map((s) => (
              <li key={s.place_id}>
                <button type="button" onClick={() => pick(s)} className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <IconMapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                  <span>{s.display_name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {allowCurrentLocation && (
          <button type="button" onClick={useCurrentLocation} disabled={locating} className={chipCls}>
            <IconMapPin size={14} /> {locating ? t("locating") : t("useMyLocation")}
          </button>
        )}
        <button type="button" onClick={() => setShowMap((v) => !v)} aria-expanded={showMap} className={chipCls}>
          {showMap ? t("hideMap") : t("pickOnMap")}
        </button>
        {hasPoint(coords) && (
          <>
            <span className="text-xs font-semibold text-emerald-700">✓ {t("locationSet")}</span>
            <button
              type="button"
              onClick={() => { onCoordsChange({ latitude: null, longitude: null }); markerRef.current?.remove(); markerRef.current = null; }}
              className="text-xs font-semibold text-rose-600 underline cursor-pointer"
            >
              {t("clearLocation")}
            </button>
          </>
        )}
      </div>

      {showMap && (
        <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200">
          <div ref={mapElRef} className="h-64 w-full" style={{ zIndex: 0 }} />
          <p className="bg-white px-3 py-2 text-[11px] text-slate-500">{t("mapTapHint")}</p>
        </div>
      )}
      {error && <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

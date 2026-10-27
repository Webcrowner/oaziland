"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { requestRide } from "@/lib/api";
import Button from "@/components/ui/Button";
import { IconAlertCircle } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import RideLocationField from "@/components/oazigo/RideLocationField";
import { RIDE_CATEGORIES, cardCls, inputCls, labelCls } from "@/components/oazigo/styles";
import { estimateFareXaf, roadDistanceKm } from "@/components/oazigo/fare";

const NO_GPS = { latitude: null, longitude: null };

export default function OaziGoRequestPage() {
  const t = useTranslations("OaziGoPage");
  const router = useRouter();
  const { reload } = useOaziGo();

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [distanceInput, setDistanceInput] = useState<string | null>(null);
  const [pickupGps, setPickupGps] = useState<{ latitude: number | null; longitude: number | null }>(NO_GPS);
  const [dropoffGps, setDropoffGps] = useState<{ latitude: number | null; longitude: number | null }>(NO_GPS);
  const [rideCategory, setRideCategory] = useState<string>("STANDARD");
  const [transportType, setTransportType] = useState<"PASSENGER" | "CARGO">("PASSENGER");
  const [hasLuggage, setHasLuggage] = useState(false);
  const [cargoDescription, setCargoDescription] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");

  // Distance comes from the two GPS points when both are captured; typing it is the fallback.
  const autoKm = roadDistanceKm(pickupGps, dropoffGps);
  const distance = distanceInput ?? (autoKm !== null ? String(autoKm) : "");
  const distanceNum = Number(distance);
  const hasDistance = distance !== "" && Number.isFinite(distanceNum) && distanceNum > 0;
  const selectedCategory = rideCategory as (typeof RIDE_CATEGORIES)[number];

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRequesting(true);
    setRequestError("");
    try {
      await requestRide({
        pickup_description: pickup,
        dropoff_description: dropoff,
        distance_km: distance,
        pickup_latitude: pickupGps.latitude,
        pickup_longitude: pickupGps.longitude,
        dropoff_latitude: dropoffGps.latitude,
        dropoff_longitude: dropoffGps.longitude,
        ride_category: rideCategory,
        transport_type: transportType,
        has_luggage: hasLuggage,
        cargo_description: transportType === "CARGO" ? cargoDescription : undefined,
      }, token);
      reload();
      router.push("/oazigo/trips");
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : t("requestFailed"));
      setRequesting(false);
    }
  }

  return (
    <form onSubmit={handleRequest} className={`${cardCls} flex flex-col gap-4`}>
      <h1 className="text-xl font-black tracking-tight text-slate-900">{t("requestRideTitle")}</h1>

      <RideLocationField
        id="oazigo-pickup"
        label={t("pickupLabel")}
        placeholder={t("pickupPlaceholder")}
        value={pickup}
        onValueChange={setPickup}
        coords={pickupGps}
        onCoordsChange={(c) => { setPickupGps(c); setDistanceInput(null); }}
        allowCurrentLocation
      />

      <RideLocationField
        id="oazigo-dropoff"
        label={t("dropoffLabel")}
        placeholder={t("dropoffPlaceholder")}
        value={dropoff}
        onValueChange={setDropoff}
        coords={dropoffGps}
        onCoordsChange={(c) => { setDropoffGps(c); setDistanceInput(null); }}
      />

      <div>
        <label className={labelCls} htmlFor="oazigo-distance">{t("distanceLabel")}</label>
        <input id="oazigo-distance" required type="number" step="0.1" min="0.1" placeholder={t("distancePlaceholder")} value={distance} onChange={(e) => setDistanceInput(e.target.value)} className={inputCls} />
        <p className="mt-1.5 text-[11px] text-slate-400">{autoKm !== null && distanceInput === null ? t("distanceAutoHint") : t("distanceManualHint")}</p>
      </div>

      <div>
        <p className={labelCls}>{t("vehicleCategoryLabel")}</p>
        <div className="flex flex-wrap gap-2">
          {RIDE_CATEGORIES.map((cat) => (
            <button
              type="button" key={cat} onClick={() => setRideCategory(cat)}
              aria-pressed={rideCategory === cat}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold border transition-colors cursor-pointer text-left ${rideCategory === cat ? "bg-slate-900 text-amber-300 border-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <span className="block">{t(`category_${cat}`)}</span>
              {hasDistance && <span className="block text-[11px] font-semibold opacity-80">≈ {estimateFareXaf(cat, distanceNum).toLocaleString()} XAF</span>}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className={labelCls}>{t("transportTypeLabel")}</p>
        <div className="grid grid-cols-2 gap-2">
          {(["PASSENGER", "CARGO"] as const).map((type) => (
            <button
              type="button" key={type} onClick={() => setTransportType(type)}
              aria-pressed={transportType === type}
              className={`rounded-xl px-3.5 py-2.5 text-sm font-bold border transition-colors cursor-pointer ${transportType === type ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {type === "PASSENGER" ? t("transportPassenger") : t("transportCargo")}
            </button>
          ))}
        </div>
      </div>

      {transportType === "CARGO" ? (
        <div>
          <label className={labelCls} htmlFor="oazigo-cargo">{t("transportCargo")}</label>
          <input id="oazigo-cargo" required placeholder={t("cargoDescriptionPlaceholder")} value={cargoDescription} onChange={(e) => setCargoDescription(e.target.value)} className={inputCls} />
        </div>
      ) : (
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={hasLuggage} onChange={(e) => setHasLuggage(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          {t("hasLuggageLabel")}
        </label>
      )}

      {hasDistance && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">{t("estimatedFare")}</p>
            <p className="text-[11px] text-emerald-700">{t("estimateNote")}</p>
          </div>
          <p className="text-xl font-black tracking-tight text-emerald-900">
            ≈ {estimateFareXaf(selectedCategory, distanceNum).toLocaleString()} <span className="text-xs font-bold">XAF</span>
          </p>
        </div>
      )}

      {requestError && (
        <p className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <IconAlertCircle size={16} className="mt-0.5 shrink-0" /> {requestError}
        </p>
      )}
      <Button size="lg" variant="success" disabled={requesting}>{requesting ? t("requesting") : t("requestRide")}</Button>
    </form>
  );
}

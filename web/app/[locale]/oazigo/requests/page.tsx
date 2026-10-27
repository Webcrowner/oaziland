"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { acceptRide, listOpenRides, setDriverLocation, type OpenRideItem } from "@/lib/api";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { IconMapPin, IconChevronRight, IconAlertCircle } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import { cardCls, inputCls, solidBtnCls } from "@/components/oazigo/styles";

const RADII = [5, 10, 20, 50];
const REFRESH_MS = 10_000;

function canServe(vehicleCategory: string, ride: OpenRideItem) {
  return ride.transport_type === "CARGO" ? vehicleCategory === "VAN" || vehicleCategory === "TRUCK" : vehicleCategory === ride.ride_category;
}

export default function OaziGoRequestsPage() {
  const t = useTranslations("OaziGoPage");
  const router = useRouter();
  const { driverProfile, vehicles, status, reload } = useOaziGo();

  const [radius, setRadius] = useState(10);
  const [rides, setRides] = useState<OpenRideItem[]>([]);
  const [located, setLocated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [vehicleByRide, setVehicleByRide] = useState<Record<string, number>>({});
  const [toggling, setToggling] = useState(false);

  const verified = Boolean(driverProfile?.is_verified);
  const online = Boolean(driverProfile?.is_online);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const data = await listOpenRides(token, radius);
      setRides(data.results);
      setLocated(data.driver_located);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setLoaded(true);
    }
  }, [radius, t]);

  useEffect(() => {
    if (!verified) return;
    Promise.resolve().then(refresh);
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [verified, refresh]);

  async function toggleOnline() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setToggling(true);
    try {
      await setDriverLocation({ is_online: !online }, token);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setToggling(false);
    }
  }

  async function handleAccept(ride: OpenRideItem) {
    const token = localStorage.getItem("access_token");
    const vehicleId = vehicleByRide[ride.id];
    if (!token || !vehicleId) return;
    try {
      await acceptRide(ride.id, vehicleId, token);
      reload();
      router.push("/oazigo/trips");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
      refresh();
    }
  }

  if (status === "loading") return null;
  if (!verified) return <EmptyState icon="🚗" title={t("requestsDriversOnly")} />;

  return (
    <div className="flex flex-col gap-4">
      <div className={`${cardCls} flex flex-wrap items-center justify-between gap-3`}>
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight text-slate-900">{t("navRequests")}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{online ? t("onlineHint") : t("offlineHint")}</p>
        </div>
        <button
          type="button" onClick={toggleOnline} disabled={toggling} aria-pressed={online}
          className={`rounded-xl px-4 py-2.5 text-sm font-bold transition-colors cursor-pointer disabled:opacity-60 ${online ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          {online ? `● ${t("youAreOnline")}` : t("goOnline")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("radiusLabel")}</span>
        {RADII.map((r) => (
          <button
            key={r} type="button" onClick={() => setRadius(r)} aria-pressed={radius === r}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${radius === r ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {r} km
          </button>
        ))}
      </div>

      {loaded && !located && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          <IconAlertCircle size={16} className="mt-0.5 shrink-0" /> {t("notLocatedHint")}
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <IconAlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {!loaded ? (
        <div className={`${cardCls} flex items-center gap-3 text-sm text-slate-500`}>
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
          {t("loadingRequests")}
        </div>
      ) : rides.length === 0 ? (
        <EmptyState icon="📡" title={t("noOpenRequests")} />
      ) : (
        rides.map((ride) => {
          const fitting = vehicles.filter((v) => canServe(v.vehicle_category, ride));
          return (
            <article key={ride.id} className={cardCls}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-900">
                    <IconMapPin size={15} className="shrink-0 text-amber-500" />
                    <span>{ride.pickup_description}</span>
                    <IconChevronRight size={14} className="shrink-0 text-slate-400" />
                    <span>{ride.dropoff_description}</span>
                  </p>
                  <p className="mt-1.5 text-lg font-black tracking-tight text-slate-900">
                    {Number(ride.fare_estimate_xaf).toLocaleString()} <span className="text-xs font-bold text-slate-500">XAF</span>
                    {ride.distance_km && <span className="ml-2 text-xs font-bold text-slate-400">· {Number(ride.distance_km).toLocaleString()} km</span>}
                  </p>
                </div>
                {ride.pickup_distance_km !== null && <Badge variant="green">{t("awayFromYou", { km: ride.pickup_distance_km })}</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="neutral">{t(`category_${ride.ride_category}`)}</Badge>
                {ride.transport_type === "CARGO" && <Badge variant="gold">{t("transportCargo")}</Badge>}
                {ride.has_luggage && <Badge variant="neutral">🧳 {t("hasLuggageLabel")}</Badge>}
                <span className="text-xs text-slate-500">{t("requestedBy", { name: ride.rider_name })}</span>
              </div>
              {ride.cargo_description && <p className="mt-2 text-xs text-slate-500">{ride.cargo_description}</p>}
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <select
                  aria-label={t("chooseVehicle")} value={vehicleByRide[ride.id] ?? ""} className={`${inputCls} sm:flex-1`}
                  onChange={(e) => setVehicleByRide((prev) => ({ ...prev, [ride.id]: Number(e.target.value) }))}
                >
                  <option value="" disabled>{t("chooseVehicle")}</option>
                  {fitting.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model} ({t(`category_${v.vehicle_category}`)})</option>)}
                </select>
                <button onClick={() => handleAccept(ride)} disabled={!vehicleByRide[ride.id]} className={solidBtnCls}>{t("acceptAsDriver")}</button>
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

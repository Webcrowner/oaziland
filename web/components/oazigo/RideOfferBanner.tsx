"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { acceptRide, declineRideOffer, getMyRideOffer, type RideOfferItem } from "@/lib/api";
import Badge from "@/components/ui/Badge";
import { IconMapPin, IconChevronRight, IconClock } from "@/components/Icons";
import { useOaziGo } from "./OaziGoProvider";
import LuggageDetails from "./LuggageDetails";
import { inputCls } from "./styles";

const POLL_MS = 4000;

function canServe(vehicleCategory: string, transportType: string, rideCategory: string) {
  return transportType === "CARGO" ? vehicleCategory === "VAN" || vehicleCategory === "TRUCK" : vehicleCategory === rideCategory;
}

/**
 * A ride offered to this driver by automatic matching, with a countdown to accept or decline, shown on
 * every OaziGo page while they're online. Offers are also pushed; while the page is open it checks every few seconds.
 */
export default function RideOfferBanner() {
  const t = useTranslations("OaziGoPage");
  const locale = useLocale();
  const router = useRouter();
  const { driverProfile, vehicles, reload } = useOaziGo();
  const [offer, setOffer] = useState<RideOfferItem | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [offerSeconds, setOfferSeconds] = useState(20);
  const [now, setNow] = useState(() => Date.now());
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownRideId = useRef<string | null>(null);

  const active = Boolean(driverProfile?.is_verified && driverProfile.is_online);

  const check = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const data = await getMyRideOffer(token);
      const next = data.offer;
      if (next && next.ride.id !== shownRideId.current) {
        shownRideId.current = next.ride.id;
        setError("");
        setVehicleId(null);
        navigator.vibrate?.([200, 100, 200]);
      }
      if (!next) shownRideId.current = null;
      setOffer(next);
      setOfferSeconds(data.offer_seconds);
      // Count down from the server's figure so a wrong phone clock can't shorten or stretch it.
      if (next) setDeadline(Date.now() + next.seconds_left * 1000);
    } catch {
      // A failed check is retried on the next tick.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void Promise.resolve().then(check);
    const poll = setInterval(check, POLL_MS);
    return () => clearInterval(poll);
  }, [active, check]);

  useEffect(() => {
    if (!offer) return;
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, [offer]);

  if (!active || !offer) return null;

  const ride = offer.ride;
  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000));
  const fitting = vehicles.filter((v) => canServe(v.vehicle_category, ride.transport_type, ride.ride_category));
  const chosen = vehicleId ?? fitting[0]?.id ?? null;
  const totalSeconds = Math.max(offerSeconds, 1);

  async function respond(accept: boolean) {
    const token = localStorage.getItem("access_token");
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      if (accept) {
        if (!chosen) return;
        await acceptRide(ride.id, chosen, token);
        setOffer(null);
        reload();
        router.push("/oazigo/trips");
      } else {
        await declineRideOffer(ride.id, token);
        setOffer(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("offerTaken"));
      void check();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:bottom-6 sm:left-auto sm:right-6 sm:w-[26rem] sm:p-0">
      <section
        role="alertdialog"
        aria-labelledby="ride-offer-title"
        className="overflow-hidden rounded-3xl border border-amber-300 bg-white shadow-2xl shadow-slate-900/25"
      >
        <div className="h-1.5 bg-slate-100">
          <div
            className="h-full bg-amber-400 transition-[width] duration-500 ease-linear"
            style={{ width: `${Math.min(100, (secondsLeft / totalSeconds) * 100)}%` }}
          />
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="ride-offer-title" className="text-base font-black tracking-tight text-slate-900">{t("offerTitle")}</h2>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${secondsLeft <= 5 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-900"}`}>
              <IconClock size={13} /> {t("offerCountdown", { seconds: secondsLeft })}
            </span>
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-900">
            <IconMapPin size={15} className="shrink-0 text-amber-500" />
            <span>{ride.pickup_description}</span>
            <IconChevronRight size={14} className="shrink-0 text-slate-400" />
            <span>{ride.dropoff_description}</span>
          </p>
          <p className="mt-1.5 text-2xl font-black tracking-tight text-slate-900">
            {Number(ride.fare_estimate_xaf).toLocaleString(locale)} <span className="text-xs font-bold text-slate-500">XAF</span>
            {ride.distance_km && <span className="ml-2 text-xs font-bold text-slate-400">· {Number(ride.distance_km).toLocaleString(locale)} km</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ride.pickup_distance_km !== null && <Badge variant="green">{t("awayFromYou", { km: ride.pickup_distance_km })}</Badge>}
            <Badge variant="neutral">{t(`category_${ride.ride_category}`)}</Badge>
            {ride.transport_type === "CARGO" && <Badge variant="gold">{t("transportCargo")}</Badge>}
          </div>
          <LuggageDetails ride={ride} />
          {ride.cargo_description && <p className="mt-2 text-xs text-slate-500">{ride.cargo_description}</p>}

          {fitting.length > 1 && (
            <select
              aria-label={t("chooseVehicle")} value={chosen ?? ""} onChange={(e) => setVehicleId(Number(e.target.value))}
              className={`${inputCls} mt-3`}
            >
              {fitting.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model} · {v.plate_number}</option>)}
            </select>
          )}
          {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

          <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
            <button
              type="button" onClick={() => respond(false)} disabled={busy}
              className="rounded-2xl border border-slate-300 bg-white py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              {t("offerDecline")}
            </button>
            <button
              type="button" onClick={() => respond(true)} disabled={busy || !chosen || secondsLeft === 0}
              className="rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
            >
              {t("offerAccept")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

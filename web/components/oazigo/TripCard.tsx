"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { startRide, completeRide, cancelRide, releaseRide, raiseRideSos, type RideBookingItem } from "@/lib/api";
import Badge from "@/components/ui/Badge";
import RideChat from "@/components/RideChat";
import RateAndReport from "@/components/RateAndReport";
import { IconMapPin, IconCompass, IconAlertCircle, IconMessageCircle, IconChevronRight } from "@/components/Icons";
import { useOaziGo } from "./OaziGoProvider";
import DriverTrackingMap from "./DriverTrackingMap";
import { STATUS_VARIANT, cardCls, dangerBtnCls, inputCls, labelCls, pillBtnCls, solidBtnCls } from "./styles";

export default function TripCard({ ride }: { ride: RideBookingItem }) {
  const t = useTranslations("OaziGoPage");
  const { myUserId, reload } = useOaziGo();

  const [showChat, setShowChat] = useState(false);
  const [paying, setPaying] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState("");
  const [sosText, setSosText] = useState("");

  const isRider = ride.rider === myUserId;
  const isDriver = ride.driver === myUserId;

  async function run(action: (token: string) => Promise<unknown>) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setError("");
    try {
      await action(token);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  function handleCancel() {
    if (!window.confirm(t("confirmCancelRide"))) return;
    run((token) => cancelRide(ride.id, token));
  }

  async function handleComplete() {
    if (!phoneNumber) return;
    await run((token) => completeRide(ride.id, phoneNumber, token));
    setPaying(false);
    setPhoneNumber("");
  }

  async function handleSos() {
    if (!window.confirm(t("sosConfirm"))) return;
    // Send the location when the browser can share it quickly; the alert goes out either way.
    const coords = await new Promise<{ latitude: number; longitude: number } | undefined>((resolve) => {
      if (!navigator.geolocation) return resolve(undefined);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(undefined),
        { timeout: 4000, maximumAge: 60000 },
      );
    });
    await run(async (token) => {
      const result = await raiseRideSos(ride.id, token, coords);
      const contact = result.emergency_contact;
      const contactSent = contact?.status === "sent";
      setSosText(
        result.admins_alerted > 0 || contactSent
          ? contactSent
            ? t("sosSentWithContact")
            : contact
              ? t("sosSentContactNotDelivered", { name: contact.name })
              : t("sosSent")
          : t("sosNoOperator"),
      );
    });
  }

  const inTrip = ride.status === "ACCEPTED" || ride.status === "IN_PROGRESS";
  const otherId = isRider ? ride.driver : ride.rider;

  return (
    <article className={`${cardCls} transition-shadow hover:shadow-md`}>
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
        <Badge variant={STATUS_VARIANT[ride.status] || "neutral"}>{ride.status.replace("_", " ")}</Badge>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <Badge variant="neutral">{t(`category_${ride.ride_category}`)}</Badge>
        {ride.transport_type === "CARGO" && <Badge variant="gold">{t("transportCargo")}</Badge>}
        {ride.has_luggage && <Badge variant="neutral">🧳 {t("hasLuggageLabel")}</Badge>}
      </div>
      {ride.cargo_description && <p className="mt-2 text-xs text-slate-500">{ride.cargo_description}</p>}

      {ride.driver && ride.status !== "CANCELLED" && (
        <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-xs text-slate-600">
          <span className="font-bold text-slate-800">
            {isRider ? t("yourDriver", { name: ride.driver_name ?? "" }) : t("yourRider", { name: ride.rider_name })}
          </span>
          {ride.vehicle_details && ` · ${ride.vehicle_details.make} ${ride.vehicle_details.model} · ${ride.vehicle_details.plate_number}`}
        </p>
      )}

      {((ride.pickup_latitude && ride.pickup_longitude) || (ride.dropoff_latitude && ride.dropoff_longitude)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {ride.pickup_latitude && ride.pickup_longitude && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${ride.pickup_latitude},${ride.pickup_longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <IconMapPin size={13} />
              <span>{t("followToPickup")}</span>
            </a>
          )}
          {ride.dropoff_latitude && ride.dropoff_longitude && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${ride.dropoff_latitude},${ride.dropoff_longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              <IconCompass size={13} />
              <span>{t("followToDropoff")}</span>
            </a>
          )}
        </div>
      )}

      {isRider && ride.driver && inTrip && (
        <div className="mt-3">
          <DriverTrackingMap key={ride.status} ride={ride} />
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <IconAlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ride.status === "ACCEPTED" && isDriver && (
          <button onClick={() => run((token) => startRide(ride.id, token))} className={solidBtnCls}>{t("startRide")}</button>
        )}
        {ride.status === "IN_PROGRESS" && !paying && (
          <button onClick={() => setPaying(true)} className={solidBtnCls}>{t("completeAndPay")}</button>
        )}
        {ride.status === "ACCEPTED" && isDriver && (
          <button onClick={() => run((token) => releaseRide(ride.id, token))} className={pillBtnCls}>{t("releaseRide")}</button>
        )}
        {(ride.status === "REQUESTED" || ride.status === "ACCEPTED") && isRider && (
          <button onClick={handleCancel} className={dangerBtnCls}>{t("cancelRide")}</button>
        )}
        {ride.driver && inTrip && (
          <button onClick={() => setShowChat((v) => !v)} className={`${pillBtnCls} inline-flex items-center gap-1.5`}>
            <IconMessageCircle size={14} />
            {showChat ? t("hideChat") : t("openChat")}
          </button>
        )}
      </div>

      {paying && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <input placeholder={t("phoneNumberPlaceholder")} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={`${inputCls} sm:flex-1`} />
          <button onClick={handleComplete} disabled={!phoneNumber} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{t("pay")}</button>
        </div>
      )}

      {inTrip && (isRider || isDriver) && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <button onClick={handleSos} className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-800 transition-colors cursor-pointer">
            🆘 {t("sosButton")}
          </button>
          {sosText && <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">{sosText}</p>}
        </div>
      )}

      {ride.status === "COMPLETED" && otherId && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className={labelCls}>{t("rateTrip")}</p>
          <RateAndReport subjectUserId={otherId} />
        </div>
      )}

      {showChat && ride.driver && inTrip && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <RideChat rideId={ride.id} myUserId={myUserId} />
        </div>
      )}
    </article>
  );
}

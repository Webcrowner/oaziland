"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  startRide, completeRide, cancelRide, releaseRide, raiseRideSos, RIDE_CANCEL_REASONS, RIDE_RELEASE_REASONS, SYSTEM_RIDE_CANCEL_REASONS,
  type RideBookingItem, type RideCancelReason, type RideReleaseReason,
} from "@/lib/api";
import Badge from "@/components/ui/Badge";
import RideChat from "@/components/RideChat";
import RateAndReport from "@/components/RateAndReport";
import { MomoBadges } from "@/components/PaymentIcons";
import { IconMapPin, IconCompass, IconAlertCircle, IconMessageCircle } from "@/components/Icons";
import { useOaziGo } from "./OaziGoProvider";
import DriverTrackingMap from "./DriverTrackingMap";
import RouteStops from "./RouteStops";
import { cardCls, dangerBtnCls, inputCls, labelCls, pillBtnCls, solidBtnCls } from "./styles";
import LuggageDetails from "@/components/oazigo/LuggageDetails";
import { RideStatusBadge, TripProgress } from "./RideStatus";
import RideReasonForm from "./RideReasonForm";
import RideIssueForm from "./RideIssueForm";

export default function TripCard({ ride }: { ride: RideBookingItem }) {
  const t = useTranslations("OaziGoPage");
  const locale = useLocale();
  const { myUserId, reload } = useOaziGo();

  const [showChat, setShowChat] = useState(false);
  const [paying, setPaying] = useState(false);
  const [waitingForFare, setWaitingForFare] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState("");
  const [sosText, setSosText] = useState("");
  const [asking, setAsking] = useState<"cancel" | "release" | null>(null);
  const [busy, setBusy] = useState(false);

  const isRider = ride.rider === myUserId;
  const isDriver = ride.driver === myUserId;

  async function run<T>(action: (token: string) => Promise<T>): Promise<T | undefined> {
    const token = localStorage.getItem("access_token");
    if (!token) return undefined;
    setError("");
    try {
      const result = await action(token);
      reload();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
      return undefined;
    }
  }

  function handleCancel(reason: RideCancelReason, note: string) {
    setBusy(true);
    run((token) => cancelRide(ride.id, token, { reason, note })).finally(() => {
      setBusy(false);
      setAsking(null);
    });
  }

  function handleRelease(reason: RideReleaseReason, note: string) {
    setBusy(true);
    run((token) => releaseRide(ride.id, token, { reason, note })).finally(() => {
      setBusy(false);
      setAsking(null);
    });
  }

  async function handleComplete() {
    if (!phoneNumber) return;
    const result = await run((token) => completeRide(ride.id, phoneNumber, token));
    // A real fare is confirmed by the provider once the rider approves it on their phone: poll until it is.
    if (result && result.status !== "COMPLETED") setWaitingForFare(true);
    setPaying(false);
    setPhoneNumber("");
  }

  // The server remembers a payment that is waiting for the rider's approval, so this survives a page reload.
  const waitingForPayment = (waitingForFare || Boolean(ride.payment_pending)) && ride.status === "IN_PROGRESS";
  useEffect(() => {
    if (!waitingForPayment) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > 8 * 60 * 1000) {
        setWaitingForFare(false);
        setError(t("paymentTimedOut"));
      } else reload();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [waitingForPayment, reload, t]);

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
  // Mirrors RIDE_ISSUE_WINDOW_DAYS on the server.
  const [withinReportWindow] = useState(() => Date.now() - new Date(ride.requested_at).getTime() < 14 * 24 * 60 * 60 * 1000);

  const live = ride.status === "REQUESTED" || inTrip;
  const bannerKey =
    ride.status === "REQUESTED" ? "liveHeadline_REQUESTED"
      : ride.status === "ACCEPTED" ? (isDriver ? "liveHeadline_ACCEPTED_driver" : "liveHeadline_ACCEPTED_rider")
        : isDriver ? "liveHeadline_IN_PROGRESS_driver" : "liveHeadline_IN_PROGRESS_rider";
  const counterpart = isRider ? ride.driver_name : ride.rider_name;

  return (
    <article className={`${cardCls} overflow-hidden transition-shadow hover:shadow-md`}>
      {live && (
        <div
          role="status"
          className={`-mx-5 -mt-5 mb-4 flex items-center gap-3 px-5 py-3.5 sm:-mx-6 sm:-mt-6 sm:px-6 ${
            ride.status === "REQUESTED" ? "bg-amber-50 text-amber-950" : "bg-slate-900 text-white"
          }`}
        >
          <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${ride.status === "REQUESTED" ? "bg-amber-500" : "bg-emerald-400"}`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${ride.status === "REQUESTED" ? "bg-amber-500" : "bg-emerald-400"}`} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black tracking-tight">{t(bannerKey)}</p>
            {ride.status === "REQUESTED" && isRider && (
              <p className="mt-0.5 text-xs font-medium text-amber-900/80">{ride.matching ? t("matchingRider") : t("openToAllRider")}</p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <p className="text-2xl font-black tracking-tight text-slate-900">
          {Number(ride.fare_estimate_xaf).toLocaleString(locale)} <span className="text-xs font-bold text-slate-500">XAF</span>
          {ride.distance_km && <span className="ml-2 text-xs font-bold text-slate-400">· {Number(ride.distance_km).toLocaleString(locale)} km</span>}
        </p>
        <RideStatusBadge status={ride.status} />
      </div>

      <div className="mt-4">
        <RouteStops pickup={ride.pickup_description} dropoff={ride.dropoff_description} pickupLabel={t("pickupLabel")} dropoffLabel={t("dropoffLabel")} />
      </div>
      <p className="mt-3 text-xs text-slate-400">
        <time dateTime={ride.requested_at}>
          {t("requestedOn", { date: new Date(ride.requested_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })}
        </time>
      </p>

      <TripProgress status={ride.status} />

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <Badge variant="neutral">{t(`category_${ride.ride_category}`)}</Badge>
        {ride.transport_type === "CARGO" && <Badge variant="gold">{t("transportCargo")}</Badge>}
      </div>
      <LuggageDetails ride={ride} />
      {ride.cargo_description && <p className="mt-2 text-xs text-slate-500">{ride.cargo_description}</p>}

      {ride.status === "CANCELLED" && ride.cancellation_reason && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-xs text-slate-600">
          <p className="font-bold text-slate-800">
            {(SYSTEM_RIDE_CANCEL_REASONS as readonly string[]).includes(ride.cancellation_reason)
              ? t(`cancelReason_${ride.cancellation_reason}`)
              : t(isRider ? "youCancelledBecause" : "riderCancelledBecause", { reason: t(`cancelReason_${ride.cancellation_reason}`) })}
          </p>
          {ride.cancellation_note && <p className="mt-1 italic">&ldquo;{ride.cancellation_note}&rdquo;</p>}
        </div>
      )}

      {ride.status === "REQUESTED" && isRider && ride.release_reason && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
          <p className="font-bold">{t("previousDriverPulledOut", { reason: t(`releaseReason_${ride.release_reason}`) })}</p>
          {ride.release_note && <p className="mt-1 italic">&ldquo;{ride.release_note}&rdquo;</p>}
        </div>
      )}

      {ride.driver && ride.status !== "CANCELLED" && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-3.5 py-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-amber-300">
            {(counterpart || "?").trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-900">
              {isRider ? t("yourDriver", { name: ride.driver_name ?? "" }) : t("yourRider", { name: ride.rider_name })}
            </span>
            {ride.vehicle_details && (
              <span className="block truncate text-xs text-slate-500">{ride.vehicle_details.make} {ride.vehicle_details.model}</span>
            )}
          </div>
          {ride.vehicle_details?.plate_number && (
            <span aria-label={`${t("plateNumber")}: ${ride.vehicle_details.plate_number}`} className="shrink-0 rounded-lg border-2 border-slate-900 bg-amber-50 px-2.5 py-1 font-mono text-xs font-black tracking-wider text-slate-900">
              {ride.vehicle_details.plate_number}
            </span>
          )}
        </div>
      )}
      {isRider && ride.status === "ACCEPTED" && ride.vehicle_details && (
        <p className="mt-2 px-1 text-[11px] font-medium text-slate-500">{t("checkPlateNote")}</p>
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

      {waitingForPayment && (
        <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900">
          {isRider ? t("approveFareOnPhone") : t("driverWaitsForPayment")}
        </p>
      )}

      {waitingForFare && ride.status === "CANCELLED" && (
        <p role="status" className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
          {t("paymentRefunded")}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ride.status === "ACCEPTED" && isDriver && (
          <button onClick={() => run((token) => startRide(ride.id, token))} className={solidBtnCls}>{t("startRide")}</button>
        )}
        {ride.status === "IN_PROGRESS" && isRider && !paying && !waitingForPayment && (
          <button onClick={() => setPaying(true)} className={solidBtnCls}>{t("completeAndPay")}</button>
        )}
        {ride.status === "ACCEPTED" && isDriver && !asking && (
          <button onClick={() => setAsking("release")} className={pillBtnCls}>{t("releaseRide")}</button>
        )}
        {(ride.status === "REQUESTED" || ride.status === "ACCEPTED") && isRider && !asking && (
          <button onClick={() => setAsking("cancel")} className={dangerBtnCls}>{t("cancelRide")}</button>
        )}
        {ride.driver && inTrip && (
          <button onClick={() => setShowChat((v) => !v)} className={`${pillBtnCls} inline-flex items-center gap-1.5`}>
            <IconMessageCircle size={14} />
            {showChat ? t("hideChat") : isRider ? t("chatWithDriver") : t("chatWithRider")}
          </button>
        )}
      </div>

      {asking === "cancel" && (
        <RideReasonForm
          title={t("cancelWhyTitle")} reasons={RIDE_CANCEL_REASONS} labelPrefix="cancelReason" confirmLabel={t("cancelRide")}
          busy={busy} onConfirm={handleCancel} onBack={() => setAsking(null)}
        />
      )}
      {asking === "release" && (
        <RideReasonForm
          title={t("releaseWhyTitle")} reasons={RIDE_RELEASE_REASONS} labelPrefix="releaseReason" confirmLabel={t("releaseRide")}
          busy={busy} onConfirm={handleRelease} onBack={() => setAsking(null)}
        />
      )}

      {paying && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <div className="relative sm:flex-1">
            <input placeholder={t("phoneNumberPlaceholder")} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={`${inputCls} w-full pr-14`} />
            <MomoBadges size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
          </div>
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

      {ride.status !== "REQUESTED" && (isRider || isDriver) && withinReportWindow && (
        <RideIssueForm rideId={ride.id} isDriver={isDriver} />
      )}

      {showChat && ride.driver && inTrip && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <RideChat rideId={ride.id} myUserId={myUserId} />
        </div>
      )}
    </article>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { setDriverLocation } from "@/lib/api";
import { IconAlertCircle } from "@/components/Icons";
import { useOaziGo } from "./OaziGoProvider";

const SEND_EVERY_MS = 10_000;
// A single dropped request is normal on mobile data; two in a row means riders are no longer seeing the driver.
const FAILURES_BEFORE_WARNING = 2;

type Health = "ok" | "denied" | "unsupported" | "sendFailed";

/**
 * Sends the driver's position to the server while they are online or
 * on a trip. A browser can only do this while the page stays open, so
 * it stops when the tab closes. When sharing breaks, the driver is told,
 * because riders silently lose sight of them otherwise.
 */
export default function DriverLocationSharer() {
  const t = useTranslations("OaziGoPage");
  const { driverProfile, myRides, myUserId } = useOaziGo();
  const lastSent = useRef(0);
  const failures = useRef(0);
  const [health, setHealth] = useState<Health>("ok");

  const onTrip = myRides.some((r) => r.driver === myUserId && (r.status === "ACCEPTED" || r.status === "IN_PROGRESS"));
  const sharing = Boolean(driverProfile?.is_verified && (driverProfile.is_online || onTrip));

  useEffect(() => {
    if (!sharing) {
      Promise.resolve().then(() => setHealth("ok"));
      return;
    }
    if (!navigator.geolocation) {
      Promise.resolve().then(() => setHealth("unsupported"));
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const token = localStorage.getItem("access_token");
        if (!token || now - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = now;
        setDriverLocation({ latitude: Number(pos.coords.latitude.toFixed(7)), longitude: Number(pos.coords.longitude.toFixed(7)) }, token)
          .then(() => {
            failures.current = 0;
            setHealth("ok");
          })
          .catch(() => {
            failures.current += 1;
            if (failures.current >= FAILURES_BEFORE_WARNING) setHealth("sendFailed");
          });
      },
      (err) => {
        // Only a refused permission is permanent; a timeout or a missing fix usually clears by itself.
        if (err.code === err.PERMISSION_DENIED) setHealth("denied");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [sharing]);

  if (!sharing || health === "ok") return null;
  return (
    <p
      role="alert"
      className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-md items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900 shadow-lg sm:bottom-6"
    >
      <IconAlertCircle size={16} className="mt-0.5 shrink-0" />
      {t(health === "denied" ? "trackingDenied" : health === "unsupported" ? "trackingUnsupported" : "trackingSendFailed")}
    </p>
  );
}

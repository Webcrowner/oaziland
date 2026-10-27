"use client";
import { useEffect, useRef } from "react";
import { setDriverLocation } from "@/lib/api";
import { useOaziGo } from "./OaziGoProvider";

const SEND_EVERY_MS = 10_000;

/**
 * Sends the driver's position to the server while they are online or
 * on a trip. A browser can only do this while the page stays open, so
 * it stops when the tab closes.
 */
export default function DriverLocationSharer() {
  const { driverProfile, myRides, myUserId } = useOaziGo();
  const lastSent = useRef(0);

  const onTrip = myRides.some((r) => r.driver === myUserId && (r.status === "ACCEPTED" || r.status === "IN_PROGRESS"));
  const sharing = Boolean(driverProfile?.is_verified && (driverProfile.is_online || onTrip));

  useEffect(() => {
    if (!sharing || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const token = localStorage.getItem("access_token");
        if (!token || now - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = now;
        setDriverLocation({ latitude: Number(pos.coords.latitude.toFixed(7)), longitude: Number(pos.coords.longitude.toFixed(7)) }, token).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [sharing]);

  return null;
}

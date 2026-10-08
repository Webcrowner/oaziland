"use client";
import { useEffect } from "react";
import { sendPresenceHeartbeat } from "@/lib/api";

const HEARTBEAT_INTERVAL_MS = 30_000;

/** Keeps the signed-in user's real "online / last seen" status fresh for everyone else. */
export default function PresenceHeartbeat() {
  useEffect(() => {
    function beat() {
      const token = localStorage.getItem("access_token");
      if (!token || document.visibilityState !== "visible") return;
      sendPresenceHeartbeat(token).catch(() => {});
    }

    function goOffline() {
      const token = localStorage.getItem("access_token");
      if (token) sendPresenceHeartbeat(token, { offline: true }).catch(() => {});
    }

    beat();
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", beat);
    window.addEventListener("pagehide", goOffline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("pagehide", goOffline);
    };
  }, []);

  return null;
}

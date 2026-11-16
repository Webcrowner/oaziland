"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";
import { IconBell, IconCheckCircle, IconAlertCircle } from "@/components/Icons";

/**
 * "Turn on notifications" for this browser. Hidden where push can't work (old browser, or the server has
 * no push keys yet). `variant="driver"` explains why it matters for ride offers.
 */
export default function PushToggle({ variant = "general" }: { variant?: "general" | "driver" }) {
  const t = useTranslations("PushToggle");
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getPushState().then((s) => alive && setState(s)).catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  async function turnOn() {
    const token = localStorage.getItem("access_token");
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      setState(await enablePush(token));
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    await disablePush(localStorage.getItem("access_token")).catch(() => {});
    setState("off");
    setBusy(false);
  }

  if (state === "loading" || state === "unsupported" || state === "disabled") return null;

  if (state === "on") {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
        <IconCheckCircle size={16} className="shrink-0" /> {t("on")}
        <button type="button" onClick={turnOff} disabled={busy} className="ml-auto text-xs font-bold text-emerald-900 underline cursor-pointer">
          {t("turnOff")}
        </button>
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <IconAlertCircle size={16} className="mt-0.5 shrink-0" /> {t("blocked")}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
        <IconBell size={18} />
      </span>
      <span className="min-w-0 flex-1 text-sm text-slate-700">{variant === "driver" ? t("driverPitch") : t("generalPitch")}</span>
      <button
        type="button" onClick={turnOn} disabled={busy}
        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
      >
        {t("turnOn")}
      </button>
      {error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}

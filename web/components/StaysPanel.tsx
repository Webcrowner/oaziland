"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listHostingReservations, listMyReservations, stayAction, type Reservation, type StayActionName } from "@/lib/api";

function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const PILL: Record<string, string> = {
  PENDING_PAYMENT: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  CHECKED_IN: "bg-sky-100 text-sky-800",
  CHECKED_OUT: "bg-slate-100 text-slate-700",
  CANCELLED: "bg-rose-100 text-rose-800",
  NO_SHOW: "bg-rose-100 text-rose-800",
};

/** A guest's stays at hotels and guest houses (`mode="guest"`), or the reservations made at the places a host owns
 * (`mode="host"`), each with the actions that make sense for its state. The rules themselves (free cancellation
 * until 48 hours before, automatic payout a day after check-out, disputes) are enforced by the server. */
export default function StaysPanel({ mode, place }: { mode: "guest" | "host"; place?: "hotel" | "guest_house" }) {
  const t = useTranslations("Stays");
  const locale = useLocale();
  const money = (value: string | number) => new Intl.NumberFormat(locale).format(Number(value));
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      setRows(mode === "guest" ? await listMyReservations(token) : await listHostingReservations(token, place));
    } catch {
      setRows([]);
    }
  }, [mode, place]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function run(r: Reservation, action: StayActionName, success: string, body?: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusyId(r.id);
    setMessage(null);
    try {
      await stayAction(r.id, action, token, body);
      setMessage({ ok: true, text: success });
      setReporting(null);
      setReason("");
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("failed") });
    } finally {
      setBusyId("");
    }
  }

  function cancelText(r: Reservation) {
    const c = r.cancellation;
    if (!c) return "";
    return c.free
      ? t("cancelFreeConfirm", { amount: money(c.refund_xaf) })
      : t("cancelFeeConfirm", { fee: money(c.fee_xaf), amount: money(c.refund_xaf) });
  }

  const today = localToday();
  const shown = (rows ?? []).filter((r) => (mode === "guest" ? r.status !== "CANCELLED" || r.check_out >= today : true));
  if (rows === null || shown.length === 0) return null;
  const btn = "rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-50 cursor-pointer";

  return (
    <section className="mb-6 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm" aria-labelledby={`stays-${mode}`}>
      <h2 id={`stays-${mode}`} className="text-base font-black text-slate-900">{mode === "guest" ? t("guestTitle") : t("hostTitle")}</h2>
      <p className="mt-1 text-xs text-slate-500">{mode === "guest" ? t("guestIntro") : t("hostIntro")}</p>
      {message && (
        <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>
      )}
      <ul className="mt-4 divide-y divide-slate-100">
        {shown.map((r) => {
          const started = r.check_in <= today;
          const afterArrivalDay = r.check_in < today;
          const busy = busyId === r.id;
          return (
            <li key={r.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">
                    {mode === "guest" && r.place_id ? (
                      <Link href={`/${r.place_kind === "guest_house" ? "guest-houses" : "hotels"}/${r.place_id}`} className="hover:text-amber-700">{r.place_name || t("stay")}</Link>
                    ) : (
                      r.guest_name
                    )}
                    <span className="font-medium text-slate-500"> · {r.room_type_name}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {day(r.check_in)} → {day(r.check_out)} · {r.adults + r.children} {t("guests")} · {money(r.rate_xaf)} XAF
                    {mode === "host" && r.place_name ? ` · ${r.place_name}` : ""}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${PILL[r.status] ?? "bg-slate-100 text-slate-700"}`}>{t(`status_${r.status}`)}</span>
              </div>

              {r.payment_held && r.payout_due_at && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {mode === "guest" ? t("heldGuest", { date: day(r.payout_due_at.slice(0, 10)) }) : t("heldHost", { date: day(r.payout_due_at.slice(0, 10)) })}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {mode === "guest" && r.cancellation && (
                  <button type="button" disabled={busy} className={`${btn} border-rose-200 text-rose-700 hover:bg-rose-50`}
                    onClick={() => { if (window.confirm(cancelText(r))) void run(r, "cancel", t("cancelled")); }}>
                    {t("cancel")}
                  </button>
                )}
                {mode === "guest" && r.status === "PENDING_PAYMENT" && (
                  <button type="button" disabled={busy} className={`${btn} border-slate-200 text-slate-700 hover:bg-slate-50`}
                    onClick={() => void run(r, "cancel", t("cancelled"))}>
                    {t("cancelUnpaid")}
                  </button>
                )}
                {mode === "guest" && r.payment_held && started && ["CONFIRMED", "CHECKED_IN"].includes(r.status) && (
                  <>
                    <button type="button" disabled={busy} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
                      onClick={() => { if (window.confirm(t("confirmStayConfirm"))) void run(r, "confirm-stay", t("stayConfirmed")); }}>
                      {t("confirmStay")}
                    </button>
                    <button type="button" disabled={busy} className={`${btn} border-slate-200 text-slate-700 hover:bg-slate-50`} onClick={() => setReporting(reporting === r.id ? null : r.id)}>
                      {t("reportProblem")}
                    </button>
                  </>
                )}
                {mode === "host" && r.status === "CONFIRMED" && (
                  <button type="button" disabled={busy} className={`${btn} border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100`} onClick={() => void run(r, "check-in", t("checkedIn"))}>
                    {t("checkIn")}
                  </button>
                )}
                {mode === "host" && r.status === "CHECKED_IN" && (
                  <button type="button" disabled={busy} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
                    onClick={() => { if (window.confirm(t("checkOutConfirm"))) void run(r, "checkout", t("checkedOut")); }}>
                    {t("checkOut")}
                  </button>
                )}
                {mode === "host" && r.status === "CONFIRMED" && afterArrivalDay && (
                  <button type="button" disabled={busy} className={`${btn} border-slate-200 text-slate-700 hover:bg-slate-50`}
                    onClick={() => { if (window.confirm(t("noShowConfirm"))) void run(r, "no-show", t("noShowDone")); }}>
                    {t("noShow")}
                  </button>
                )}
                {mode === "host" && r.cancellation && (
                  <button type="button" disabled={busy} className={`${btn} border-rose-200 text-rose-700 hover:bg-rose-50`}
                    onClick={() => { if (window.confirm(t("hostCancelConfirm"))) void run(r, "cancel", t("cancelled")); }}>
                    {t("cancelAndRefund")}
                  </button>
                )}
              </div>

              {mode === "guest" && reporting === r.id && (
                <form
                  className="mt-3 flex flex-col gap-2"
                  onSubmit={(e) => { e.preventDefault(); void run(r, "dispute", t("reported"), reason); }}
                >
                  <label className="text-xs font-semibold text-slate-600">
                    {t("reportLabel")}
                    <textarea required minLength={5} maxLength={2000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                      className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                  <p className="text-[11px] text-slate-500">{t("reportNote")}</p>
                  <button type="submit" disabled={busy || reason.trim().length < 5} className={`${btn} self-start border-slate-900 bg-slate-900 text-white`}>{t("sendReport")}</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

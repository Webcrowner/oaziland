"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { eventBookingAction, listVenueBookings, type EventActionName, type EventBookingPayState } from "@/lib/api";

const PILL: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-slate-100 text-slate-700",
  CANCELLED: "bg-rose-100 text-rose-800",
};

function localNow() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** The bookings made at the signed-in owner's venues: who booked, what is paid and what the venue will receive. The
 * owner can cancel (the organiser is refunded in full) or, once the event is over, mark it complete to be paid at
 * once; otherwise the payment is released automatically 48 hours after the event unless the organiser reports a
 * problem. All the rules are enforced by the server. */
export default function VenueOwnerBookingsPanel() {
  const t = useTranslations("VenueOwnerBookings");
  const locale = useLocale();
  const money = (value: string | number) => new Intl.NumberFormat(locale).format(Number(value));
  const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const [rows, setRows] = useState<EventBookingPayState[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      setRows(await listVenueBookings(token));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function run(b: EventBookingPayState, action: EventActionName, success: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusyId(b.id);
    setMessage(null);
    try {
      await eventBookingAction(b.id, action, token);
      setMessage({ ok: true, text: success });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("actionFailed") });
    } finally {
      setBusyId("");
    }
  }

  if (!rows || rows.length === 0) return null;
  const now = localNow();
  const btn = "rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-50 cursor-pointer";
  const sorted = [...rows].sort((a, b) => b.event_date.localeCompare(a.event_date));

  return (
    <section className="mb-6 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm" aria-labelledby="venue-owner-bookings">
      <h2 id="venue-owner-bookings" className="text-base font-black text-slate-900">{t("title")}</h2>
      <p className="mt-1 text-xs text-slate-500">{t("intro")}</p>
      {message && (
        <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>
      )}
      <ul className="mt-4 divide-y divide-slate-100">
        {sorted.map((b) => {
          const busy = busyId === b.id;
          const ended = `${b.event_date}T${b.end_time.slice(0, 5)}` <= now;
          return (
            <li key={b.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">
                    {b.space_name} <span className="font-medium text-slate-500">· {b.organiser_name}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {day(b.event_date)} · {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)} · {b.guest_count} {t("guests")} · {money(b.total_cost_xaf)} XAF
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${PILL[b.status] ?? "bg-slate-100 text-slate-700"}`}>{t(`status_${b.status}`)}</span>
              </div>
              {b.status !== "CANCELLED" && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {t("paidLine", { deposit: b.deposit_paid ? t("paid") : t("unpaid"), balance: b.balance_paid ? t("paid") : t("unpaid") })}
                </p>
              )}
              {b.balance_due_at && <p className="mt-1 text-[11px] font-semibold text-amber-800">{t("balanceDue", { date: day(b.balance_due_at) })}</p>}
              {b.owner_payout_xaf && b.payout_due_at && (
                <p className="mt-1 text-[11px] text-slate-500">{t("payoutNote", { amount: money(b.owner_payout_xaf), date: day(b.payout_due_at) })}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {b.status === "CONFIRMED" && b.payment_held && ended && b.balance_paid && (
                  <button type="button" disabled={busy} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
                    onClick={() => { if (window.confirm(t("completeConfirm"))) void run(b, "complete", t("completed")); }}>
                    {t("complete")}
                  </button>
                )}
                {b.cancellation && (
                  <button type="button" disabled={busy} className={`${btn} border-rose-200 text-rose-700 hover:bg-rose-50`}
                    onClick={() => { if (window.confirm(t("cancelConfirm", { amount: money(b.cancellation?.refund_xaf ?? 0) }))) void run(b, "cancel", t("cancelled")); }}>
                    {t("cancel")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

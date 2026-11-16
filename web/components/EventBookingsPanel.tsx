"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { eventBookingAction, listMyEventBookings, type EventActionName, type EventBookingPayState } from "@/lib/api";
import EventPayForm from "@/components/EventPayForm";

const PILL: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-slate-100 text-slate-700",
  CANCELLED: "bg-rose-100 text-rose-800",
};

function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** The venues the signed-in user has booked for events: what is still to pay (the deposit that confirms the date,
 * then the balance), and the actions that fit each state. Cancelling, the balance deadline, payout and disputes are
 * enforced by the server. Shows nothing when they have no venue bookings. */
export default function EventBookingsPanel() {
  const t = useTranslations("EventPayment");
  const locale = useLocale();
  const money = (value: string | number) => new Intl.NumberFormat(locale).format(Number(value));
  const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const [rows, setRows] = useState<EventBookingPayState[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      setRows(await listMyEventBookings(token));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function run(b: EventBookingPayState, action: EventActionName, success: string, body?: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusyId(b.id);
    setMessage(null);
    try {
      await eventBookingAction(b.id, action, token, body);
      setMessage({ ok: true, text: success });
      setReporting(null);
      setReason("");
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("actionFailed") });
    } finally {
      setBusyId("");
    }
  }

  function cancelText(b: EventBookingPayState) {
    const c = b.cancellation;
    if (!c) return "";
    return c.free
      ? t("cancelFreeConfirm", { amount: money(c.refund_xaf) })
      : t("cancelFeeConfirm", { fee: money(c.fee_xaf), amount: money(c.refund_xaf) });
  }

  if (!rows || rows.length === 0) return null;
  const today = localToday();
  const btn = "rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-50 cursor-pointer";

  return (
    <section className="mb-6 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm" aria-labelledby="event-bookings">
      <h2 id="event-bookings" className="text-base font-black text-slate-900">{t("title")}</h2>
      <p className="mt-1 text-xs text-slate-500">{t("intro")}</p>
      {message && (
        <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>
      )}
      <ul className="mt-4 divide-y divide-slate-100">
        {rows.map((b) => {
          const busy = busyId === b.id;
          const started = b.event_date <= today;
          return (
            <li key={b.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">
                    <Link href={`/events/${b.venue_id}`} className="hover:text-amber-700">{b.space_name}</Link>
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
              {b.balance_due_at && (
                <p className="mt-1 text-[11px] font-semibold text-amber-800">{t("balanceDue", { date: day(b.balance_due_at) })}</p>
              )}
              {b.payment_held && b.payout_due_at && (
                <p className="mt-1 text-[11px] text-slate-500">{t("heldNote", { date: day(b.payout_due_at) })}</p>
              )}

              {b.status === "PENDING" && !b.deposit_paid && (
                <div className="mt-3 flex flex-col gap-2">
                  <EventPayForm bookingId={b.id} part="deposit" amountXaf={b.deposit_amount_xaf} onPaid={load} />
                  <button type="button" disabled={busy} className={`${btn} self-start border-slate-200 text-slate-700 hover:bg-slate-50`}
                    onClick={() => void run(b, "cancel", t("cancelled"))}>
                    {t("cancelUnpaid")}
                  </button>
                </div>
              )}
              {b.status === "CONFIRMED" && !b.balance_paid && !started && (
                <div className="mt-3"><EventPayForm bookingId={b.id} part="balance" amountXaf={b.balance_amount_xaf} onPaid={load} /></div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {b.cancellation && (
                  <button type="button" disabled={busy} className={`${btn} border-rose-200 text-rose-700 hover:bg-rose-50`}
                    onClick={() => { if (window.confirm(cancelText(b))) void run(b, "cancel", t("cancelled")); }}>
                    {t("cancel")}
                  </button>
                )}
                {b.status === "CONFIRMED" && b.payment_held && started && (
                  <>
                    <button type="button" disabled={busy} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
                      onClick={() => { if (window.confirm(t("confirmEventConfirm"))) void run(b, "confirm-event", t("eventConfirmed")); }}>
                      {t("confirmEvent")}
                    </button>
                    <button type="button" disabled={busy} className={`${btn} border-slate-200 text-slate-700 hover:bg-slate-50`} onClick={() => setReporting(reporting === b.id ? null : b.id)}>
                      {t("reportProblem")}
                    </button>
                  </>
                )}
              </div>

              {reporting === b.id && (
                <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run(b, "dispute", t("reported"), reason); }}>
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

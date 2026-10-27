"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { listMyBookings, openDispute, cancelBooking, type BookingItem } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import DirectChatButton from "@/components/DirectChatButton";
import DisputeChat from "@/components/DisputeChat";
import { getMyProfile } from "@/lib/api";
import {
  IconFileText,
  IconMapPin,
  IconHotel,
  IconParty,
  IconGraduationCap,
  IconBed,
  IconHome,
  IconWrench,
  IconShoppingBag,
  IconCar,
  IconShield,
  IconClock,
} from "@/components/Icons";

type TypeIcon = React.ComponentType<{ size?: number; className?: string }>;
const TYPE_ICONS: Record<string, TypeIcon> = {
  LAND_RESERVATION: IconMapPin,
  HOTEL: IconHotel,
  EVENT: IconParty,
  HOSTEL_SEMESTER: IconGraduationCap,
  GUEST_HOUSE: IconBed,
  GENERAL_RENTAL: IconHome,
  SERVICE_REQUEST: IconWrench,
  MARKETPLACE_ITEM: IconShoppingBag,
  RIDE: IconCar,
};

const STATUS_PILL: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  PAYMENT_PROCESSING: "bg-amber-50 text-amber-800 border-amber-200",
  REFUNDING: "bg-amber-50 text-amber-800 border-amber-200",
  CONFIRMED: "bg-sky-50 text-sky-800 border-sky-200",
  CHECKED_IN: "bg-sky-50 text-sky-800 border-sky-200",
  COMPLETED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  PAYMENT_FAILED: "bg-red-50 text-red-700 border-red-200",
  CANCELLED: "bg-slate-100 text-slate-600 border-slate-200",
  EXPIRED: "bg-slate-100 text-slate-600 border-slate-200",
};

const ESCROW_PILL: Record<string, string> = {
  HELD: "bg-sky-50 text-sky-800",
  RELEASED: "bg-emerald-50 text-emerald-800",
  REFUNDED: "bg-slate-100 text-slate-700",
  DISPUTED: "bg-red-50 text-red-700",
};

const DISPUTE_PILL: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-800",
  ADMIN_RESPONDED: "bg-sky-50 text-sky-800",
  RESOLVED: "bg-emerald-50 text-emerald-800",
  ESCALATED: "bg-red-50 text-red-700",
};

// Only unpaid bookings can be cancelled this way — once escrow is held,
// backing out needs a real refund via the dispute flow instead.
const CANCELLABLE_STATUSES = ["PENDING", "PAYMENT_PROCESSING", "PAYMENT_FAILED"];

/**
 * My Bookings — the real gap this closes: open_dispute() existed,
 * fully built (real SLA deadlines, flips the escrow to DISPUTED),
 * but was never called from anywhere reachable on web — a real
 * person whose payment went wrong had no way to raise the issue at
 * all. The page itself is also new: there was previously no single
 * place a person could see every real booking they'd made across
 * property rentals, hotels, event venues, rides, or Taskln Service.
 */
export default function BookingsPage() {
  const t = useTranslations("BookingsPage");
  const locale = useLocale();
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [activeDisputeChatId, setActiveDisputeChatId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  // Dashboard cards link here with ?filter=active|completed.
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("filter");
    if (preset === "active" || preset === "completed") {
      void Promise.resolve().then(() => setFilter(preset));
    }
  }, []);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([
      listMyBookings(token),
      getMyProfile(token).catch(() => null),
    ]).then(([data, profile]) => {
      setBookings(data.results);
      if (profile) setMyUserId(profile.id);
      setStatus("ready");
    }).catch(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function handleOpenDispute(bookingId: string) {
    const token = localStorage.getItem("access_token");
    if (!token || !reason.trim()) return;
    setError("");
    setSubmitting(true);
    try {
      await openDispute(bookingId, reason, token);
      setDisputingId(null);
      setReason("");
      // Real persisted status now — re-fetch rather than guessing it locally.
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("disputeFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelBooking(bookingId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setCancellingId(bookingId);
    try {
      await cancelBooking(bookingId, token);
      load();
    } catch {
      alert(t("cancelFailed"));
    } finally {
      setCancellingId(null);
    }
  }

  if (status === "signedOut") {
    return (
      <AccountSidebarLayout activeHref="/bookings">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  const isActive = (b: BookingItem) => b.status === "PENDING" || b.status === "CONFIRMED";
  const visibleBookings = bookings.filter((b) =>
    filter === "active" ? isActive(b) : filter === "completed" ? b.status === "COMPLETED" : true
  );
  const activeCount = bookings.filter(isActive).length;
  const completedCount = bookings.filter((b) => b.status === "COMPLETED").length;
  const totalValue = bookings
    .filter((b) => b.status !== "CANCELLED" && b.status !== "EXPIRED" && b.status !== "PAYMENT_FAILED")
    .reduce((sum, b) => sum + Number(b.amount_xaf), 0);
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";

  const stats = [
    { label: t("statTotal"), value: bookings.length.toLocaleString(dateLocale) },
    { label: t("statActive"), value: activeCount.toLocaleString(dateLocale) },
    { label: t("statCompleted"), value: completedCount.toLocaleString(dateLocale) },
    { label: t("statSpent"), value: `${totalValue.toLocaleString(dateLocale)} XAF` },
  ];

  return (
    <AccountSidebarLayout activeHref="/bookings">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
              <IconFileText size={28} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("title")}</h1>
              <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
            </div>
          </div>
          {status === "ready" && bookings.length > 0 && (
            <dl className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {stats.map((s) => (
                <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <dt className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{s.label}</dt>
                  <dd className="mt-1 text-lg sm:text-xl font-black text-white truncate">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {status === "ready" && bookings.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {(["all", "active", "completed"] as const).map((key) => {
            const count = key === "all" ? bookings.length : key === "active" ? activeCount : completedCount;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold border transition-colors cursor-pointer ${
                  filter === key ? "bg-slate-900 text-white border-slate-900 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {t(key === "all" ? "filterAll" : key === "active" ? "filterActive" : "filterCompleted")}
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${filter === key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {status === "loading" ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={<IconFileText size={28} />}
          title={t("noBookingsYet")}
          action={<Button href="/">{t("browseListings")}</Button>}
        />
      ) : visibleBookings.length === 0 ? (
        <EmptyState icon={<IconFileText size={28} />} title={t("noBookingsInFilter")} />
      ) : (
        <div className="flex flex-col gap-4">
          {visibleBookings.map((booking) => {
            const TypeIconCmp = TYPE_ICONS[booking.booking_type] ?? IconFileText;
            return (
              <article key={booking.id} className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-amber-300">
                    <TypeIconCmp size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-base font-black tracking-tight text-slate-900">{t(`bookingType_${booking.booking_type}`)}</h2>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${STATUS_PILL[booking.status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {booking.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xl font-black text-slate-900">
                      {Number(booking.amount_xaf).toLocaleString(dateLocale)} <span className="text-sm font-bold text-slate-400">XAF</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <IconClock size={13} />
                        {t("bookedOn")} {new Date(booking.created_at).toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      {booking.escrow_status && (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-bold ${ESCROW_PILL[booking.escrow_status]}`}>
                          <IconShield size={12} />
                          {t(`escrow_${booking.escrow_status}`)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {booking.target_owner && (
                  <div className="mt-4">
                    <DirectChatButton
                      recipientId={booking.target_owner}
                      recipientName={booking.target_owner_name || "Host / Provider"}
                      label={`Chat with ${booking.target_owner_name || "Host / Provider"}`}
                      className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold px-3.5 py-2 rounded-xl text-xs transition-colors border border-slate-200"
                    />
                  </div>
                )}

                {booking.dispute_status ? (
                  <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${DISPUTE_PILL[booking.dispute_status] || "bg-slate-100 text-slate-700"}`}>
                        {t("disputeStatusLabel")}: {t(`disputeStatus_${booking.dispute_status}`)}
                      </span>
                      {booking.dispute_status === "RESOLVED" && (
                        <span className="text-xs text-slate-500">
                          {t("disputeOutcome")}: {booking.escrow_status === "REFUNDED" ? t("disputeOutcomeRefunded") : t("disputeOutcomeReleased")}
                          {booking.dispute_resolution_notes ? ` — ${booking.dispute_resolution_notes}` : ""}
                        </span>
                      )}
                    </div>

                    {booking.dispute_id && (
                      <div>
                        <button
                          onClick={() =>
                            setActiveDisputeChatId(activeDisputeChatId === booking.dispute_id ? null : (booking.dispute_id || null))
                          }
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 hover:underline cursor-pointer"
                        >
                          <span>⚖️ {activeDisputeChatId === booking.dispute_id ? "Hide Dispute Mediation Chat" : "Open 3-Way Dispute Mediation Chat"}</span>
                        </button>

                        {activeDisputeChatId === booking.dispute_id && (
                          <DisputeChat disputeId={booking.dispute_id} myUserId={myUserId} />
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {(!booking.dispute_status && booking.has_escrow && disputingId !== booking.id) || CANCELLABLE_STATUSES.includes(booking.status) ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                    {!booking.dispute_status && booking.has_escrow && disputingId !== booking.id && (
                      <button
                        onClick={() => setDisputingId(booking.id)}
                        className="rounded-xl border border-red-200 px-3.5 py-2 text-xs font-bold text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        {t("openDispute")}
                      </button>
                    )}
                    {CANCELLABLE_STATUSES.includes(booking.status) && (
                      <button
                        onClick={() => handleCancelBooking(booking.id)}
                        disabled={cancellingId === booking.id}
                        className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {cancellingId === booking.id ? t("cancelling") : t("cancelBooking")}
                      </button>
                    )}
                  </div>
                ) : null}

                {disputingId === booking.id && (
                  <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-red-100 bg-red-50/40 p-4">
                    <textarea
                      rows={3} placeholder={t("disputeReasonPlaceholder")} value={reason} onChange={(e) => setReason(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15"
                    />
                    {error && <p className="text-red-600 text-xs">{error}</p>}
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleOpenDispute(booking.id)} disabled={submitting} className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer">
                        {submitting ? t("submitting") : t("submitDispute")}
                      </button>
                      <button onClick={() => { setDisputingId(null); setReason(""); setError(""); }} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </AccountSidebarLayout>
  );
}

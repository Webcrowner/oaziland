"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { listMyBookings, openDispute, type BookingItem } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const STATUS_VARIANT: Record<string, "navy" | "gold" | "green" | "clay"> = {
  PENDING: "gold", PAYMENT_PROCESSING: "gold", PAYMENT_FAILED: "clay", CONFIRMED: "navy",
  CHECKED_IN: "navy", COMPLETED: "green", CANCELLED: "clay", REFUNDING: "gold", EXPIRED: "clay",
};

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
  const [disputedIds, setDisputedIds] = useState<string[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    listMyBookings(token).then((data) => { setBookings(data.results); setStatus("ready"); }).catch(() => setStatus("ready"));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleOpenDispute(bookingId: string) {
    const token = localStorage.getItem("access_token");
    if (!token || !reason.trim()) return;
    setError("");
    try {
      await openDispute(bookingId, reason, token);
      setDisputedIds((prev) => [...prev, bookingId]);
      setDisputingId(null);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("disputeFailed"));
    }
  }

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Button href="/login">{t("signInRequired")}</Button>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : bookings.length === 0 ? (
        <EmptyState icon="🧾" title={t("noBookingsYet")} />
      ) : (
        <div className="flex flex-col gap-3">
          {bookings.map((booking) => (
            <div key={booking.id} className="border border-gray-200 rounded-xl p-4 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <p className="text-sm font-semibold text-[var(--navy)]">{t(`bookingType_${booking.booking_type}`)}</p>
                <Badge variant={STATUS_VARIANT[booking.status] || "neutral"}>{booking.status.replace(/_/g, " ")}</Badge>
              </div>
              <p className="text-sm text-gray-600 mb-1">{Number(booking.amount_xaf).toLocaleString()} XAF</p>
              <p className="text-xs text-gray-400 mb-3">{new Date(booking.created_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US")}</p>

              {disputedIds.includes(booking.id) ? (
                <p className="text-sm text-green-700">✓ {t("disputeSubmitted")}</p>
              ) : booking.has_escrow && disputingId !== booking.id ? (
                <button onClick={() => setDisputingId(booking.id)} className="text-xs text-[var(--clay)] underline font-semibold">
                  {t("openDispute")}
                </button>
              ) : null}

              {disputingId === booking.id && (
                <div className="mt-2 flex flex-col gap-2">
                  <textarea
                    rows={2} placeholder={t("disputeReasonPlaceholder")} value={reason} onChange={(e) => setReason(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm"
                  />
                  {error && <p className="text-red-600 text-xs">{error}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => handleOpenDispute(booking.id)} className="bg-[var(--clay)] text-white text-xs font-semibold px-3 py-2 rounded">
                      {t("submitDispute")}
                    </button>
                    <button onClick={() => { setDisputingId(null); setReason(""); setError(""); }} className="text-xs text-gray-500">
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

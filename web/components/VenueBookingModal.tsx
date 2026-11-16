"use client";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { createEventBooking, type EventBooking, type Venue, type VenueSpaceSummary } from "@/lib/api";
import EventPayForm from "@/components/EventPayForm";
import Button from "@/components/ui/Button";
import { IconCheckCircle } from "@/components/Icons";

/** Booking a venue space for an event: pick the space, date, times and guests. The server prices it from the
 * space's hourly rate and takes the deposit into escrow. Used on the venues list and on a venue's own page. */
export default function VenueBookingModal({ venue, initialSpaceId, onClose }: { venue: Venue; initialSpaceId?: string; onClose: () => void }) {
  const t = useTranslations("VenuesPage");
  const router = useRouter();
  // Booking modal state
  const [bookingSpace, setBookingSpace] = useState(initialSpaceId ?? venue.spaces[0]?.id ?? "");
  const [eventType, setEventType] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [bookingStatus, setBookingStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [bookingError, setBookingError] = useState("");
  const [created, setCreated] = useState<EventBooking | null>(null);
  const [depositPaid, setDepositPaid] = useState(false);
  const tp = useTranslations("EventPayment");
  const onDepositPaid = useCallback(() => setDepositPaid(true), []);

  const selectedSpace: VenueSpaceSummary | undefined = venue.spaces.find((s) => s.id === bookingSpace);
  const estimatedHours =
    startTime && endTime ? (new Date(`2000-01-01T${endTime}`).getTime() - new Date(`2000-01-01T${startTime}`).getTime()) / 3600000 : 0;
  const bookingTotal = selectedSpace && estimatedHours > 0 ? estimatedHours * Number(selectedSpace.base_price_per_hour_xaf) : 0;

  async function handleBookingSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setBookingStatus("submitting");
    try {
      const booking = await createEventBooking(
        {
          venue_space: bookingSpace,
          event_type: eventType,
          event_date: eventDate,
          start_time: startTime,
          end_time: endTime,
          guest_count: Number(guestCount),
        },
        token
      );
      setCreated(booking);
      setBookingStatus("success");
    } catch (err) {
      setBookingStatus("error");
      setBookingError(err instanceof Error ? err.message : t("bookingFailed"));
    }
  }

  return (
    <>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            {bookingStatus === "success" ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                  <IconCheckCircle size={24} />
                </div>
                <h3 className="font-bold text-slate-900 text-lg mb-1.5">{depositPaid ? tp("depositPaidTitle") : t("bookingConfirmedTitle")}</h3>
                <p className="text-xs text-slate-500 mb-5">{depositPaid ? tp("depositPaidBody") : tp("requestedBody")}</p>
                {created && !depositPaid && (
                  <div className="mb-5 text-left">
                    <EventPayForm bookingId={created.id} part="deposit" amountXaf={created.deposit_amount_xaf} onPaid={onDepositPaid} />
                  </div>
                )}
                <div className="flex gap-2">
                  <Link
                    href="/bookings"
                    className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors"
                  >
                    {t("viewMyBookings")}
                  </Link>
                  <button
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-colors"
                  >
                    {t("close")}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleBookingSubmit}>
                <div className="flex items-start justify-between mb-4">
                  <h3 className="font-bold text-slate-900 text-lg">{t("bookSpace")}</h3>
                  <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
                    &times;
                  </button>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {t("selectSpace")}
                    </label>
                    <select
                      value={bookingSpace}
                      onChange={(e) => setBookingSpace(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                    >
                      {venue.spaces.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.space_name} — {Number(s.base_price_per_hour_xaf).toLocaleString()} XAF/hr
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {t("eventType")}
                    </label>
                    <input
                      required
                      placeholder="Wedding, Conference, Birthday..."
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {t("eventDate")}
                    </label>
                    <input
                      required
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        {t("startTime")}
                      </label>
                      <input
                        required
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        {t("endTime")}
                      </label>
                      <input
                        required
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {t("guestCount")}
                    </label>
                    <input
                      required
                      type="number"
                      min={1}
                      value={guestCount}
                      onChange={(e) => setGuestCount(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                    />
                  </div>

                  {bookingTotal > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/60 flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-900">{t("totalLabel")}</span>
                      <span className="text-sm font-bold text-slate-900">{bookingTotal.toLocaleString()} XAF</span>
                    </div>
                  )}

                  {bookingStatus === "error" && <p className="text-red-600 text-xs font-medium">{bookingError}</p>}

                  <Button disabled={bookingStatus === "submitting"} className="w-full" size="lg">
                    {bookingStatus === "submitting" ? t("bookingSubmitting") : t("confirmBooking")}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </>
  );
}

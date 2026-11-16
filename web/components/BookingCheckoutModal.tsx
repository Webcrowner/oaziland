"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  createGenericBooking,
  payGenericBooking,
  createReservation,
  payReservation,
  getReservation,
  getBookingById,
  type Hotel,
} from "@/lib/api";
import Button from "@/components/ui/Button";
import {
  IconLock,
  IconShieldCheck,
  IconCheckCircle,
  IconAlertCircle,
  IconSparkles,
} from "@/components/Icons";

export interface BookingCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingType: "HOTEL" | "HOSTEL_SEMESTER" | "GENERAL_RENTAL" | "LAND_RESERVATION" | "EVENT" | "GUEST_HOUSE";
  title: string;
  quarterName: string;
  priceXaf: number | string;
  pricePeriodLabel?: string; // e.g. "per night", "per month", "deposit"
  targetId: string;
  targetContentType?: string; // e.g. "hotels.Reservation", "property.Listing", "student_hostels.StudentHostel"
  hotelObject?: Hotel | null;
  roomTypeId?: string;
  /** Booking a price-per-period target (a hostel room type): how many periods may be paid at once, and how to
   * label N periods ("3 months"). The server prices it as its own price × the periods chosen. */
  maxPeriods?: number;
  periodLabel?: (count: number) => string;
  /** A hotel stay already chosen on the hotel's page: its dates, guests and the server's price for it, shown as the
   * total instead of rate × nights. */
  stay?: { checkIn: string; checkOut: string; adults: number; children: number; totalXaf: number; summary: string };
}

export default function BookingCheckoutModal({
  isOpen,
  onClose,
  bookingType,
  title,
  quarterName,
  priceXaf,
  pricePeriodLabel = "total",
  targetId,
  targetContentType = "property.Listing",
  hotelObject,
  roomTypeId,
  maxPeriods,
  periodLabel,
  stay,
}: BookingCheckoutModalProps) {
  const router = useRouter();
  const t = useTranslations("BookingCheckout");
  const locale = useLocale();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [monthsCount, setMonthsCount] = useState(1);
  const [step, setStep] = useState<"form" | "processing" | "waiting" | "success" | "error">("form");
  // A real payment is confirmed by the provider after the payer approves it on their phone: we poll until it is.
  const [pending, setPending] = useState<{ kind: "reservation" | "booking"; id: string } | null>(null);
  const pollStarted = useRef(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmedBookingId, setConfirmedBookingId] = useState("");
  const [chargedAmount, setChargedAmount] = useState<number | null>(null);

  useEffect(() => {
    if (step !== "waiting" || !pending) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    pollStarted.current = Date.now();
    let stopped = false;
    const check = async () => {
      if (stopped) return;
      try {
        const state = pending.kind === "reservation"
          ? await getReservation(pending.id, token).then((r) => ({
              done: r.status === "CONFIRMED",
              failed: ["PAYMENT_FAILED", "EXPIRED", "CANCELLED"].includes(r.payment_status ?? "") || r.status === "CANCELLED",
              cancelled: r.status === "CANCELLED" || r.payment_status === "CANCELLED",
            }))
          : await getBookingById(pending.id, token).then((b) => ({
              done: b.status === "CONFIRMED",
              failed: ["PAYMENT_FAILED", "EXPIRED", "CANCELLED"].includes(b.status),
              cancelled: b.status === "CANCELLED",
            }));
        if (stopped) return;
        if (state.done) {
          setStep("success");
        } else if (state.failed) {
          setErrorMessage(state.cancelled
            ? t("lateRefund")
            : t("notCompleted"));
          setStep("error");
        } else if (Date.now() - pollStarted.current > 8 * 60 * 1000) {
          setErrorMessage(t("timedOut"));
          setStep("error");
        }
      } catch {
        // A failed check is not a failed payment: keep waiting and ask again.
      }
    };
    const timer = window.setInterval(check, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [step, pending, t]);

  if (!isOpen) return null;

  const baseRate = Number(priceXaf) || 0;
  let computedTotal = baseRate;

  if (stay) {
    computedTotal = stay.totalXaf;
  } else if (bookingType === "HOTEL" || bookingType === "GUEST_HOUSE") {
    if (checkIn && checkOut) {
      const nights = Math.max(
        1,
        Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
      );
      computedTotal = baseRate * nights;
    }
  } else if (bookingType === "HOSTEL_SEMESTER") {
    computedTotal = baseRate * monthsCount;
  }

  async function handleConfirmAndPay(e: React.FormEvent) {
    e.preventDefault();
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      router.push("/login");
      return;
    }

    setStep("processing");
    setErrorMessage("");

    try {
      if (bookingType === "HOTEL" && (roomTypeId || hotelObject)) {
        // Room reservation (hotel or guest house room type)
        const activeRoomType =
          roomTypeId || hotelObject?.room_types[0]?.id;
        if (!activeRoomType) throw new Error(t("noRoomType"));

        const todayDate = new Date();
        const tomorrowDate = new Date(todayDate);
        tomorrowDate.setDate(todayDate.getDate() + 1);
        const res = await createReservation(
          {
            room_type: activeRoomType,
            check_in: stay?.checkIn || checkIn || todayDate.toISOString().slice(0, 10),
            check_out: stay?.checkOut || checkOut || tomorrowDate.toISOString().slice(0, 10),
            adults: stay?.adults ?? 1,
            children: stay?.children ?? 0,
            special_requests: `Booked via Oaziland Instant Escrow Checkout - ${phoneNumber}`,
          },
          token
        );

        // Starts the Mobile Money payment; the reservation is confirmed once the provider confirms the money arrived.
        const paid = await payReservation(res.id, phoneNumber, token);
        setConfirmedBookingId(res.id);
        setChargedAmount(Number(res.rate_xaf));
        if (paid.status === "CONFIRMED") {
          setStep("success");
        } else {
          setPending({ kind: "reservation", id: res.id });
          setStep("waiting");
        }
      } else {
        // Generic Property/Hostel/GuestHouse Booking
        const booking = await createGenericBooking(
          {
            booking_type: bookingType,
            target_content_type: targetContentType,
            target_id: targetId,
            amount_xaf: computedTotal,
            ...(bookingType === "HOSTEL_SEMESTER" ? { quantity: monthsCount } : {}),
          },
          token
        );

        // Starts the MoMo payment into escrow; it is held once the provider confirms the money arrived.
        const paid = await payGenericBooking(booking.id, phoneNumber, token);
        setConfirmedBookingId(booking.id);
        setChargedAmount(Number(booking.amount_xaf));
        if (paid.status === "CONFIRMED") {
          setStep("success");
        } else {
          setPending({ kind: "booking", id: booking.id });
          setStep("waiting");
        }
      }
    } catch (err: unknown) {
      setStep("error");
      const msg = err instanceof Error ? err.message : t("checkoutFailed");
      setErrorMessage(msg);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-slate-200/90 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle decorative glow */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

        {step === "waiting" ? (
          <div className="text-center py-6 space-y-4" role="status" aria-live="polite">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto animate-pulse">
              <IconLock size={30} />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-xl">{t("approveTitle")}</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                {t("approveBody", { phone: phoneNumber, amount: computedTotal.toLocaleString(locale) })}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-xs font-bold text-slate-500 hover:text-slate-800 py-1">
              {t("closeKeepBooking")}
            </button>
          </div>
        ) : step === "success" ? (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
              <IconCheckCircle size={32} />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-xl">
                {t("confirmedTitle")}
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                {t.rich("confirmedBody", { amount: (chargedAmount ?? computedTotal).toLocaleString(locale), strong: (chunks) => <strong className="text-slate-900">{chunks}</strong> })}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-left text-xs text-emerald-950 space-y-1.5">
              <p className="font-bold flex items-center gap-1.5">
                <IconShieldCheck size={16} className="text-emerald-600" />
                <span>{t("guaranteeTitle")}</span>
              </p>
              <p className="text-[11px] leading-relaxed text-emerald-800">
                {t("guaranteeBody")}
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <Button href="/bookings" className="w-full">
                {t("viewLedger")}
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 py-1"
              >
                {t("close")}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleConfirmAndPay} className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 inline-flex items-center gap-1 mb-1">
                  <IconShieldCheck size={11} />
                  <span>{t("badge")}</span>
                </span>
                <h3 className="font-black text-slate-900 text-base sm:text-lg leading-tight">
                  {title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{quarterName}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            {/* Dates / Duration selection */}
            {stay && (
              <p className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">{stay.summary}</p>
            )}

            {!stay && (bookingType === "HOTEL" || bookingType === "GUEST_HOUSE") && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    {t("checkIn")}
                  </label>
                  <input
                    required
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    {t("checkOut")}
                  </label>
                  <input
                    required
                    type="date"
                    min={checkIn || new Date().toISOString().slice(0, 10)}
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 bg-slate-50"
                  />
                </div>
              </div>
            )}

            {bookingType === "HOSTEL_SEMESTER" && (
              <div>
                <label htmlFor="checkout-periods" className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  {t("term")}
                </label>
                <select
                  id="checkout-periods"
                  value={monthsCount}
                  onChange={(e) => setMonthsCount(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 bg-slate-50"
                >
                  {Array.from({ length: Math.max(1, maxPeriods ?? 1) }, (_, i) => i + 1).map((count) => (
                    <option key={count} value={count}>{periodLabel ? periodLabel(count) : count}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Cameroon Payment Method */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700">
                {t("momoLabel")}
              </label>
              <div className="relative">
                <input
                  required
                  type="tel"
                  placeholder="+237 6XXXXXXXX"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                />
              </div>
              <p className="text-[10px] text-slate-400">
                {t("momoHint")}
              </p>
            </div>

            {/* Escrow Guarantee Pill */}
            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconLock size={15} className="text-amber-600 shrink-0" />
                <span className="text-xs font-bold text-slate-900">{t("totalEscrow")}</span>
              </div>
              <span className="text-sm font-black text-amber-700">
                {computedTotal.toLocaleString(locale)} XAF
              </span>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2">
                <IconAlertCircle size={14} className="text-rose-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                type="submit"
                disabled={step === "processing"}
                className="flex-1 py-3 text-xs font-black shadow-md shadow-amber-500/20"
              >
                {step === "processing" ? t("locking") : t("authorize", { amount: computedTotal.toLocaleString(locale) })}
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

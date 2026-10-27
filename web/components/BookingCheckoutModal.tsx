"use client";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  createGenericBooking,
  payGenericBooking,
  createReservation,
  payReservation,
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
}: BookingCheckoutModalProps) {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [monthsCount, setMonthsCount] = useState(1);
  const [step, setStep] = useState<"form" | "processing" | "success" | "error">("form");
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmedBookingId, setConfirmedBookingId] = useState("");

  if (!isOpen) return null;

  const baseRate = Number(priceXaf) || 0;
  let computedTotal = baseRate;

  if (bookingType === "HOTEL" || bookingType === "GUEST_HOUSE") {
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
      if (bookingType === "HOTEL" && hotelObject) {
        // Hotel reservation flow
        const activeRoomType =
          roomTypeId || hotelObject.room_types[0]?.id;
        if (!activeRoomType) throw new Error("No room type configured for this hotel.");

        const todayDate = new Date();
        const tomorrowDate = new Date(todayDate);
        tomorrowDate.setDate(todayDate.getDate() + 1);
        const res = await createReservation(
          {
            room_type: activeRoomType,
            check_in: checkIn || todayDate.toISOString().slice(0, 10),
            check_out: checkOut || tomorrowDate.toISOString().slice(0, 10),
            adults: 1,
            special_requests: `Booked via Oaziland Instant Escrow Checkout - ${phoneNumber}`,
          },
          token
        );

        // Immediate Mobile Money Escrow lock
        await payReservation(res.id, phoneNumber, token);
        setConfirmedBookingId(res.id);
        setStep("success");
      } else {
        // Generic Property/Hostel/GuestHouse Booking
        const booking = await createGenericBooking(
          {
            booking_type: bookingType,
            target_content_type: targetContentType,
            target_id: targetId,
            amount_xaf: computedTotal,
          },
          token
        );

        // Immediate MoMo payment into Escrow (HELD)
        await payGenericBooking(booking.id, phoneNumber, token);
        setConfirmedBookingId(booking.id);
        setStep("success");
      }
    } catch (err: unknown) {
      setStep("error");
      const msg = err instanceof Error ? err.message : "Payment checkout failed";
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

        {step === "success" ? (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
              <IconCheckCircle size={32} />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-xl">
                Escrow Deposit Confirmed!
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                Your payment of <strong className="text-slate-900">{computedTotal.toLocaleString()} XAF</strong> has been securely locked in platform escrow.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-left text-xs text-emerald-950 space-y-1.5">
              <p className="font-bold flex items-center gap-1.5">
                <IconShieldCheck size={16} className="text-emerald-600" />
                <span>Zero-Risk Guarantee:</span>
              </p>
              <p className="text-[11px] leading-relaxed text-emerald-800">
                The property owner or host will not receive your payment until you arrive, inspect the unit, and approve completion.
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <Button href="/bookings" className="w-full">
                View My Escrow Booking Ledger
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 py-1"
              >
                Close
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
                  <span>Instant Escrow Booking</span>
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
            {(bookingType === "HOTEL" || bookingType === "GUEST_HOUSE") && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Check-in Date
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
                    Check-out Date
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
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Tenure / Term
                </label>
                <select
                  value={monthsCount}
                  onChange={(e) => setMonthsCount(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 bg-slate-50"
                >
                  <option value={1}>1 Month Security Deposit</option>
                  <option value={3}>1 Academic Trimester (3 Months)</option>
                  <option value={6}>Full Academic Semester (6 Months)</option>
                  <option value={10}>Full Academic Year (10 Months)</option>
                </select>
              </div>
            )}

            {/* Cameroon Payment Method */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700">
                Cameroon Mobile Money (MTN MoMo / Orange Money)
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
                A secure USSD push will prompt your phone to authorize the escrow lock.
              </p>
            </div>

            {/* Escrow Guarantee Pill */}
            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconLock size={15} className="text-amber-600 shrink-0" />
                <span className="text-xs font-bold text-slate-900">Total Escrow Amount:</span>
              </div>
              <span className="text-sm font-black text-amber-700">
                {computedTotal.toLocaleString()} XAF
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
                {step === "processing" ? "Locking Escrow Deposit..." : `Authorize Escrow (${computedTotal.toLocaleString()} XAF)`}
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

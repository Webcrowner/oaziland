"use client";
import { useState } from "react";
import BookingCheckoutModal from "@/components/BookingCheckoutModal";
import { IconLock, IconShieldCheck } from "@/components/Icons";

interface EscrowBookingButtonProps {
  listingId: string;
  title: string;
  quarterName: string;
  priceXaf: string | number;
  listingType: string; // RENT or SALE
}

export default function EscrowBookingButton({
  listingId,
  title,
  quarterName,
  priceXaf,
  listingType,
}: EscrowBookingButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const isRent = listingType === "RENT";
  // In Cameroon rentals, a 1-month deposit or reservation hold is customary
  const initialDeposit = Number(priceXaf) || 0;

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs sm:text-sm font-black transition-all shadow-md shadow-slate-900/15 flex items-center justify-center gap-2 border border-slate-700/80"
      >
        <IconLock size={15} className="text-amber-400" />
        <span>{isRent ? "Lock Rental Deposit via Escrow" : "Reserve Property with Escrow Deposit"}</span>
      </button>

      <BookingCheckoutModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        bookingType={isRent ? "GENERAL_RENTAL" : "LAND_RESERVATION"}
        title={title}
        quarterName={quarterName}
        priceXaf={initialDeposit}
        pricePeriodLabel={isRent ? "deposit" : "reservation deposit"}
        targetId={listingId}
        targetContentType="property.Listing"
      />
    </>
  );
}

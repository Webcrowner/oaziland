export const LISTING_PRICE_BASES: { value: string; label: string }[] = [
  { value: "SALE", label: "For sale" },
  { value: "RENT_MONTHLY", label: "Rent / month" },
  { value: "RENT_WEEKLY", label: "Rent / week" },
  { value: "RENT_NIGHTLY", label: "Rent / night" },
  { value: "RENT_ANNUAL", label: "Rent / year" },
];

/** A refundable deposit only exists for rentals; a sale, or a blank field, sends "0". */
export function depositFor(priceBasis: string, deposit: string): string {
  return priceBasis === "SALE" ? "0" : deposit.trim() || "0";
}

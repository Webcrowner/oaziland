import type { MarketplaceOffer, MarketplaceOfferStatus } from "./api";

export type OfferRole = "buying" | "selling";
export type OfferAction = "accept" | "decline" | "counter" | "withdraw" | "pay";

// Mirrors backend/marketplace/offers.py: lower offers are refused outright.
export const MIN_OFFER_SHARE = 0.3;
const DATED_CAR_RENTAL_BASIS = "RENT_NIGHTLY";

export const OFFER_STATUS_LABELS: Record<MarketplaceOfferStatus, string> = {
  PENDING: "Waiting for the seller", COUNTERED: "Counter-offer received", ACCEPTED: "Accepted, ready to pay", PAID: "Paid",
  DECLINED: "Declined", WITHDRAWN: "Withdrawn", EXPIRED: "Expired",
};

export function offerStatusLabel(status: MarketplaceOfferStatus, role: OfferRole): string {
  if (role === "selling") {
    if (status === "PENDING") return "Waiting for your answer";
    if (status === "COUNTERED") return "Counter-offer sent";
    if (status === "ACCEPTED") return "Accepted, waiting for payment";
  }
  return OFFER_STATUS_LABELS[status];
}

/** What the caller may do with an offer, given the side they are on. "pay" opens the listing to pay the agreed price. */
export function offerActions(status: MarketplaceOfferStatus, role: OfferRole): OfferAction[] {
  if (role === "selling") return status === "PENDING" ? ["accept", "counter", "decline"] : [];
  if (status === "COUNTERED") return ["accept", "withdraw"];
  if (status === "PENDING") return ["withdraw"];
  if (status === "ACCEPTED") return ["pay", "withdraw"];
  return [];
}

/** The price the offer currently stands at: agreed, else the seller's counter, else the buyer's offer. */
export function offerCurrentAmount(offer: Pick<MarketplaceOffer, "amount_xaf" | "counter_amount_xaf" | "agreed_amount_xaf" | "status">): number {
  if (offer.status === "COUNTERED" && offer.counter_amount_xaf) return Number(offer.counter_amount_xaf);
  return Number(offer.agreed_amount_xaf ?? offer.amount_xaf);
}

export function canMakeOffer(listing: { allow_offers?: boolean; availability_status: string; price_basis: string; has_variants?: boolean }, category: string, isLister: boolean): boolean {
  const datedCarRental = category === "cars" && listing.price_basis === DATED_CAR_RENTAL_BASIS;
  // Prices differ per version, so the server refuses offers on items with options.
  return Boolean(listing.allow_offers) && !listing.has_variants && listing.availability_status === "AVAILABLE" && !isLister && !datedCarRental;
}

/** Whole XAF only, as the server expects; null when the text is not a positive whole number. */
export function parseAmount(text: string): number | null {
  const digits = text.replace(/[\s,]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return value > 0 ? value : null;
}

export function offerAmountError(text: string, askingXaf: number): string {
  const amount = parseAmount(text);
  if (amount === null) return "Enter your offer in XAF.";
  if (amount >= askingXaf) return "Your offer is at or above the asking price: just buy it at that price.";
  if (amount < Math.round(askingXaf * MIN_OFFER_SHARE)) return `Offers must be at least ${Math.round(MIN_OFFER_SHARE * 100)}% of the asking price.`;
  return "";
}

export function counterAmountError(text: string, buyerOfferXaf: number, askingXaf: number): string {
  const amount = parseAmount(text);
  if (amount === null) return "Enter your counter-offer in XAF.";
  if (amount <= buyerOfferXaf || amount >= askingXaf) {
    return `A counter-offer must be between the buyer's ${buyerOfferXaf.toLocaleString()} XAF and your asking ${askingXaf.toLocaleString()} XAF.`;
  }
  return "";
}

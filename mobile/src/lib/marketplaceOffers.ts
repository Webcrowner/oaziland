import type { MarketplaceOffer, MarketplaceOfferStatus } from "./api";
import { translateEnglish, type Translate } from "../i18n/translate";

export type OfferRole = "buying" | "selling";
export type OfferAction = "accept" | "decline" | "counter" | "withdraw" | "pay";

// Mirrors backend/marketplace/offers.py: lower offers are refused outright.
export const MIN_OFFER_SHARE = 0.3;
const DATED_CAR_RENTAL_BASIS = "RENT_NIGHTLY";

export const OFFER_STATUS_LABELS: Record<MarketplaceOfferStatus, string> = {
  PENDING: "Waiting for the seller", COUNTERED: "Counter-offer received", ACCEPTED: "Accepted, ready to pay", PAID: "Paid",
  DECLINED: "Declined", WITHDRAWN: "Withdrawn", EXPIRED: "Expired",
};

export function offerStatusLabel(status: MarketplaceOfferStatus, role: OfferRole, t: Translate = translateEnglish): string {
  if (role === "selling") {
    if (status === "PENDING") return t("mkt.offers.sellPENDING");
    if (status === "COUNTERED") return t("mkt.offers.sellCOUNTERED");
    if (status === "ACCEPTED") return t("mkt.offers.sellACCEPTED");
  }
  return t(`mkt.offers.status${status}`);
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

export function offerAmountError(text: string, askingXaf: number, t: Translate = translateEnglish): string {
  const amount = parseAmount(text);
  if (amount === null) return t("mkt.offers.errEnterOffer");
  if (amount >= askingXaf) return t("mkt.offers.errAtOrAbove");
  if (amount < Math.round(askingXaf * MIN_OFFER_SHARE)) return t("mkt.offers.errMinShare", { pct: Math.round(MIN_OFFER_SHARE * 100) });
  return "";
}

export function counterAmountError(text: string, buyerOfferXaf: number, askingXaf: number, t: Translate = translateEnglish): string {
  const amount = parseAmount(text);
  if (amount === null) return t("mkt.offers.errEnterCounter");
  if (amount <= buyerOfferXaf || amount >= askingXaf) {
    return t("mkt.offers.errCounterRange", { buyer: buyerOfferXaf.toLocaleString(), asking: askingXaf.toLocaleString() });
  }
  return "";
}

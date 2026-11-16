import type { MessageKey } from "../i18n/messages";
import type { Coords } from "./location";

export const GOODS_CATEGORIES = [
  "ELECTRONICS", "PHONES", "FASHION", "HOME", "APPLIANCES", "FOOD", "BUILDING", "TOOLS", "VEHICLE_PARTS", "BABY", "SPORTS", "OTHER",
] as const;
export const GOODS_CONDITIONS = ["NEW", "LIKE_NEW", "USED"] as const;
export type GoodsCategoryCode = (typeof GOODS_CATEGORIES)[number];
export type GoodsConditionCode = (typeof GOODS_CONDITIONS)[number];

export const MAX_GOODS_MEDIA = 20;
const MAX_FEE_XAF = 1_000_000;
const MAX_QUANTITY = 100_000;

export interface GoodsDraft {
  title: string;
  description: string;
  itemCategory: GoodsCategoryCode | "";
  condition: GoodsConditionCode;
  price: string;
  compareAt: string;
  quantity: string;
  quarterId: string;
  pickup: boolean;
  sellerDelivery: boolean;
  sellerFee: string;
  sellerAreas: string;
  courier: boolean;
  courierFee: string;
  courierNote: string;
}

export const EMPTY_GOODS_DRAFT: GoodsDraft = {
  title: "", description: "", itemCategory: "", condition: "USED", price: "", compareAt: "", quantity: "1", quarterId: "",
  pickup: true, sellerDelivery: false, sellerFee: "", sellerAreas: "", courier: false, courierFee: "", courierNote: "",
};

function validFee(value: string): boolean {
  if (value.trim() === "") return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_FEE_XAF;
}

/** The "was" price is optional but must be a number above the selling price. Returns a translation key, or null. */
export function compareAtError(compareAt: string, price: string): MessageKey | null {
  if (!compareAt.trim()) return null;
  const was = Number(compareAt);
  if (!Number.isFinite(was) || was <= 0 || was <= Number(price)) return "goods.error.compareAt";
  return null;
}

/** The first thing wrong with the draft (a translation key), or null when it can be posted. */
export function goodsDraftError(draft: GoodsDraft): MessageKey | null {
  if (!draft.title.trim()) return "goods.error.title";
  if (!draft.itemCategory) return "goods.error.category";
  const price = Number(draft.price);
  if (!draft.price.trim() || !Number.isFinite(price) || price <= 0) return "goods.error.price";
  const compareAt = compareAtError(draft.compareAt, draft.price);
  if (compareAt) return compareAt;
  const quantity = Number(draft.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return "goods.error.quantity";
  if (!draft.quarterId) return "goods.error.quarter";
  if (!draft.pickup && !draft.sellerDelivery && !draft.courier) return "goods.error.delivery";
  if ((draft.sellerDelivery && !validFee(draft.sellerFee)) || (draft.courier && !validFee(draft.courierFee))) return "goods.error.fee";
  return null;
}

/** The body the server expects; fees and notes of a delivery option that is switched off are not sent. */
export function goodsPayload(draft: GoodsDraft, coords: Coords | null): Record<string, unknown> {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    price_basis: "SALE",
    price_xaf: draft.price.trim(),
    ...(draft.compareAt.trim() ? { compare_at_price_xaf: draft.compareAt.trim() } : {}),
    item_category: draft.itemCategory,
    condition: draft.condition,
    quantity: Number(draft.quantity),
    quarter: draft.quarterId,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    pickup_available: draft.pickup,
    seller_delivery: draft.sellerDelivery,
    seller_delivery_fee_xaf: draft.sellerDelivery ? draft.sellerFee.trim() || "0" : "0",
    seller_delivery_areas: draft.sellerDelivery ? draft.sellerAreas.trim() : "",
    courier_shipping: draft.courier,
    courier_fee_xaf: draft.courier ? draft.courierFee.trim() || "0" : "0",
    courier_note: draft.courier ? draft.courierNote.trim() : "",
  };
}

/** Pulls the first readable message out of the server's JSON error text, or returns the fallback. */
export function listingErrorText(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  try {
    const data = JSON.parse(error.message) as Record<string, unknown>;
    if (typeof data.detail === "string") return data.detail;
    for (const value of Object.values(data)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string" && first) return first;
    }
  } catch {
    // Not a JSON error; use the fallback.
  }
  return fallback;
}

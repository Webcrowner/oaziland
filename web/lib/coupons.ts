import type { MarketplaceCoupon } from "./api";

export const COUPON_CODE_PATTERN = /^[A-Za-z0-9_-]{3,30}$/;

/** Coupon codes are stored uppercase and limited to letters, digits, "-" and "_". */
export function normalizeCouponCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase().slice(0, 30);
}

export type CouponStatus = "inactive" | "scheduled" | "expired" | "exhausted" | "active";

export function couponStatus(coupon: Pick<MarketplaceCoupon, "is_active" | "starts_at" | "expires_at" | "max_uses" | "uses">, now: number = Date.now()): CouponStatus {
  if (!coupon.is_active) return "inactive";
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now) return "expired";
  if (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) return "exhausted";
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) return "scheduled";
  return "active";
}

/** The discount a coupon gives, as the amount to format: a percentage or a whole-XAF value. */
export function couponDiscount(coupon: Pick<MarketplaceCoupon, "kind" | "value">): { kind: "PERCENT" | "FIXED"; amount: number } {
  return { kind: coupon.kind, amount: Math.round(Number(coupon.value)) };
}

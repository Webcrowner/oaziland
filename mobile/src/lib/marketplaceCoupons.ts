import { parseMoment, MOMENT_FORMAT_HINT } from "./dateTimeInput";
import type { CouponKind, MarketplaceCoupon } from "./api";

export interface CouponDraft {
  code: string;
  kind: CouponKind;
  value: string;
  minOrder: string;
  maxUses: string;
  startsAt: string;
  expiresAt: string;
}

export const EMPTY_COUPON_DRAFT: CouponDraft = { code: "", kind: "PERCENT", value: "", minOrder: "", maxUses: "", startsAt: "", expiresAt: "" };

/** Codes are letters, digits, "-" and "_" (3 to 30), stored uppercase. */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

const wholeNumber = (text: string) => /^\d+$/.test(text.trim());

export function couponDraftError(draft: CouponDraft, now: number = Date.now()): string {
  if (!/^[A-Z0-9_-]{3,30}$/.test(normalizeCouponCode(draft.code))) return "The code must be 3 to 30 letters, digits, - or _.";
  if (!wholeNumber(draft.value) || Number(draft.value) < 1) return draft.kind === "PERCENT" ? "Enter a percentage from 1 to 90." : "Enter the discount in XAF.";
  if (draft.kind === "PERCENT" && Number(draft.value) > 90) return "A percentage discount can be at most 90%.";
  if (draft.minOrder.trim() && !wholeNumber(draft.minOrder)) return "The minimum order must be a whole number of XAF.";
  if (draft.maxUses.trim() && (!wholeNumber(draft.maxUses) || Number(draft.maxUses) < 1)) return "Maximum uses must be 1 or more, or blank for unlimited.";
  const starts = draft.startsAt.trim() ? parseMoment(draft.startsAt) : null;
  const expires = draft.expiresAt.trim() ? parseMoment(draft.expiresAt, true) : null;
  if (draft.startsAt.trim() && !starts) return `Enter the start as ${MOMENT_FORMAT_HINT}, or leave it blank.`;
  if (draft.expiresAt.trim() && !expires) return `Enter the expiry as ${MOMENT_FORMAT_HINT}, or leave it blank.`;
  if (expires && new Date(expires).getTime() <= now) return "The expiry must be in the future.";
  if (starts && expires && new Date(starts).getTime() >= new Date(expires).getTime()) return "The coupon must start before it expires.";
  return "";
}

export function couponPayload(draft: CouponDraft): Record<string, unknown> {
  return {
    code: normalizeCouponCode(draft.code),
    kind: draft.kind,
    value: Number(draft.value),
    min_order_xaf: draft.minOrder.trim() ? Number(draft.minOrder) : 0,
    max_uses: draft.maxUses.trim() ? Number(draft.maxUses) : null,
    starts_at: draft.startsAt.trim() ? parseMoment(draft.startsAt) : null,
    expires_at: draft.expiresAt.trim() ? parseMoment(draft.expiresAt, true) : null,
  };
}

export function couponDiscountLabel(coupon: Pick<MarketplaceCoupon, "kind" | "value" | "min_order_xaf">): string {
  const value = Number(coupon.value);
  const off = coupon.kind === "PERCENT" ? `${value}% off` : `${value.toLocaleString()} XAF off`;
  const min = Number(coupon.min_order_xaf);
  return min > 0 ? `${off} orders over ${min.toLocaleString()} XAF` : off;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** One line on a coupon row: how often it was used and whether it can be used now. */
export function couponStatusLabel(coupon: MarketplaceCoupon, now: number = Date.now()): string {
  const used = coupon.max_uses == null ? `${coupon.uses} used` : `${coupon.uses}/${coupon.max_uses} used`;
  let validity = "Valid";
  if (!coupon.is_active) validity = "Switched off";
  else if (coupon.max_uses != null && coupon.uses >= coupon.max_uses) validity = "Used up";
  else if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now) validity = `Expired ${day(coupon.expires_at)}`;
  else if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) validity = `Starts ${day(coupon.starts_at)}`;
  else if (coupon.expires_at) validity = `Valid until ${day(coupon.expires_at)}`;
  return `${used} · ${validity}`;
}

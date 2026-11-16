import type { CartDeliveryOption, CartGroup, CartItem, CartQuoteRequest } from "./api";
import { translateEnglish, type Translate } from "../i18n/translate";

export type CartDeliveryMethod = CartDeliveryOption["method"];

export const MIN_ADDRESS_LENGTH = 5;

export const formatXaf = (amount: number | string): string => `${Number(amount).toLocaleString()} XAF`;

export function deliveryMethodLabel(method: CartDeliveryMethod, t: Translate = translateEnglish): string {
  return t(`mkt.delivery.${method}`);
}

/** "Pick it up · free", "Courier shipping · +2,500 XAF". */
export function deliveryOptionLabel(option: CartDeliveryOption, t: Translate = translateEnglish): string {
  const fee = Number(option.fee_xaf);
  return `${deliveryMethodLabel(option.method, t)} · ${fee > 0 ? `+${formatXaf(fee)}` : t("mkt.free")}`;
}

export function needsDeliveryAddress(method: CartDeliveryMethod | ""): boolean {
  return method !== "" && method !== "PICKUP";
}

/** A single way to receive the items needs no choice. */
export function chosenDeliveryMethod(options: CartDeliveryOption[], picked: CartDeliveryMethod | ""): CartDeliveryMethod | "" {
  if (options.length === 1) return options[0].method;
  return options.some((o) => o.method === picked) ? picked : "";
}

/** "99+" keeps the cart badge small. */
export function cartBadge(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

export function unavailableItems(group: CartGroup): number {
  return group.items.filter((item) => !item.available).length;
}

/** One cart line is one listing in one version: the same listing in two sizes is two lines. */
export function cartLineKey(item: Pick<CartItem, "listing_id" | "variant_id">): string {
  return `${item.listing_id}:${item.variant_id ?? ""}`;
}

export function quoteRequest(
  sellerId: string, method: CartDeliveryMethod, address: string, couponCode: string,
): CartQuoteRequest {
  const trimmedAddress = address.trim();
  const code = couponCode.trim();
  return {
    seller_id: sellerId,
    delivery_method: method,
    ...(needsDeliveryAddress(method) && trimmedAddress.length >= MIN_ADDRESS_LENGTH ? { delivery_address: trimmedAddress } : {}),
    ...(code ? { coupon_code: code } : {}),
  };
}

/** Why the pay button is still disabled, or "" when the group can be paid for. */
export function checkoutBlocker(
  group: CartGroup, method: CartDeliveryMethod | "", address: string, phone: string, hasQuote: boolean,
  t: Translate = translateEnglish,
): string {
  if (!group.can_checkout) return t("mkt.cart.blockUnavailable");
  if (group.delivery_options.length === 0) return t("mkt.cart.blockNoDelivery");
  if (method === "") return t("mkt.cart.blockChoose");
  if (needsDeliveryAddress(method) && address.trim().length < MIN_ADDRESS_LENGTH) return t("mkt.cart.blockAddress");
  if (!hasQuote) return t("mkt.cart.blockTotal");
  if (!phone.trim()) return t("mkt.cart.blockPhone");
  return "";
}

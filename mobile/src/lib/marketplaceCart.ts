import type { CartDeliveryOption, CartGroup, CartItem, CartQuoteRequest } from "./api";

export type CartDeliveryMethod = CartDeliveryOption["method"];

export const MIN_ADDRESS_LENGTH = 5;

const METHOD_LABELS: Record<CartDeliveryMethod, string> = { PICKUP: "Pick it up", SELLER: "Seller delivers", COURIER: "Courier shipping" };

export const formatXaf = (amount: number | string): string => `${Number(amount).toLocaleString()} XAF`;

export function deliveryMethodLabel(method: CartDeliveryMethod): string {
  return METHOD_LABELS[method];
}

/** "Pick it up · free", "Courier shipping · +2,500 XAF". */
export function deliveryOptionLabel(option: CartDeliveryOption): string {
  const fee = Number(option.fee_xaf);
  return `${deliveryMethodLabel(option.method)} · ${fee > 0 ? `+${formatXaf(fee)}` : "free"}`;
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
): string {
  if (!group.can_checkout) return "Remove the unavailable items to check out.";
  if (group.delivery_options.length === 0) return "This seller offers no delivery option for these items together.";
  if (method === "") return "Choose how you want to get your items.";
  if (needsDeliveryAddress(method) && address.trim().length < MIN_ADDRESS_LENGTH) return "Enter a delivery address.";
  if (!hasQuote) return "Working out your total...";
  if (!phone.trim()) return "Enter your Mobile Money phone number.";
  return "";
}

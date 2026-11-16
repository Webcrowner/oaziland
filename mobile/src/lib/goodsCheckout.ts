import type { GoodsListing } from "./api";

export type DeliveryMethod = "PICKUP" | "SELLER" | "COURIER";

export interface DeliveryOption {
  method: DeliveryMethod;
  feeXaf: number;
  label: string;
}

/** The ways a seller offers to hand a goods item over, with the fee each adds to the price. */
export function deliveryOptions(listing: Pick<GoodsListing, "pickup_available" | "seller_delivery" | "seller_delivery_fee_xaf" | "courier_shipping" | "courier_fee_xaf">): DeliveryOption[] {
  const options: DeliveryOption[] = [];
  if (listing.pickup_available) options.push({ method: "PICKUP", feeXaf: 0, label: "Pick it up" });
  if (listing.seller_delivery) options.push({ method: "SELLER", feeXaf: Number(listing.seller_delivery_fee_xaf ?? 0), label: "Seller delivers" });
  if (listing.courier_shipping) options.push({ method: "COURIER", feeXaf: Number(listing.courier_fee_xaf ?? 0), label: "Courier shipping" });
  return options;
}

/** A whole number of units between 1 and what is in stock. */
export function clampQuantity(value: number, stock: number): number {
  const whole = Math.floor(Number.isFinite(value) ? value : 1);
  return Math.min(Math.max(1, stock), Math.max(1, whole));
}

/** What the server charges for a goods order: price × quantity plus the delivery fee. */
export function goodsTotal(unitPriceXaf: number, quantity: number, feeXaf: number): number {
  return unitPriceXaf * quantity + feeXaf;
}

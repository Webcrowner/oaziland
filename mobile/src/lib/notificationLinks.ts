import type { BrowsableCategory, NotificationTarget } from "./api";

export type NotificationRole = "buying" | "selling";

/** The screen a notification opens, with the params that screen takes. */
export type NotificationRoute =
  | { name: "MarketplaceOrders"; params: { role?: NotificationRole; orderId: string } }
  | { name: "MarketplaceOffers"; params: { role?: NotificationRole } }
  | { name: "MarketplaceListingDetail"; params: { category: BrowsableCategory; listingId: string } }
  | { name: "ListingDetail"; params: { listingId: string } }
  | { name: "OaziGo"; params: undefined };

const CATEGORIES: readonly string[] = ["warehouses", "stores", "businesses", "cars", "goods"];

function role(value: unknown): NotificationRole | undefined {
  return value === "buying" || value === "selling" ? value : undefined;
}

/** Where a tap on a notification should go, or null when it has no (known) target. */
export function notificationRoute(target: NotificationTarget | null | undefined): NotificationRoute | null {
  if (!target || typeof target.kind !== "string") return null;
  const id = target.id === undefined || target.id === null ? "" : String(target.id);
  switch (target.kind) {
    case "marketplace_order":
      return id ? { name: "MarketplaceOrders", params: { role: role(target.role), orderId: id } } : null;
    case "marketplace_offer":
      return { name: "MarketplaceOffers", params: { role: role(target.role) } };
    case "marketplace_listing":
      return id && target.category && CATEGORIES.includes(target.category)
        ? { name: "MarketplaceListingDetail", params: { category: target.category as BrowsableCategory, listingId: id } }
        : null;
    case "listing":
      return id ? { name: "ListingDetail", params: { listingId: id } } : null;
    case "ride":
      return { name: "OaziGo", params: undefined };
    default:
      return null;
  }
}

import type { NotificationTarget } from "@/lib/api";

/** The role tab named in a ?role= query parameter; anything else means "no preference". */
export function roleFromParam(value: string | null | undefined): "buying" | "selling" | null {
  return value === "buying" || value === "selling" ? value : null;
}

const segment = (value: string | number) => encodeURIComponent(String(value));

/** Where tapping a notification should lead (a locale-less path), or null when it has no destination. */
export function notificationHref(target: NotificationTarget | null | undefined): string | null {
  if (!target || target.id === undefined || target.id === null || target.id === "") return null;
  const id = segment(target.id);
  switch (target.kind) {
    case "marketplace_order": {
      const params = new URLSearchParams();
      const role = roleFromParam(target.role);
      if (role) params.set("role", role);
      params.set("order", String(target.id));
      return `/marketplace/orders?${params.toString()}`;
    }
    case "marketplace_offer": {
      const params = new URLSearchParams();
      const role = roleFromParam(target.role);
      if (role) params.set("role", role);
      params.set("offer", String(target.id));
      return `/marketplace/offers?${params.toString()}`;
    }
    case "marketplace_listing":
      return target.category ? `/marketplace/${segment(target.category)}/${id}` : null;
    case "listing":
      return `/listing/${id}`;
    case "job":
      return `/careers?job=${id}`;
    case "ride":
      return "/oazigo/trips";
    default:
      return null;
  }
}

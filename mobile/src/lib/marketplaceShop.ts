import { parseDay } from "./dateTimeInput";
import type { MarketplaceShop, MarketplaceShopSettings } from "./api";

export const SHOP_LIMITS = { name: 80, tagline: 140, announcement: 200, vacationMessage: 200 } as const;

export interface ShopDraft {
  name: string;
  tagline: string;
  description: string;
  logoUrl: string;
  bannerUrl: string;
  shippingPolicy: string;
  returnPolicy: string;
  announcement: string;
  onVacation: boolean;
  vacationMessage: string;
  vacationUntil: string;
}

export const EMPTY_SHOP_DRAFT: ShopDraft = {
  name: "", tagline: "", description: "", logoUrl: "", bannerUrl: "", shippingPolicy: "", returnPolicy: "",
  announcement: "", onVacation: false, vacationMessage: "", vacationUntil: "",
};

export function shopDraftFrom(shop: MarketplaceShopSettings): ShopDraft {
  return {
    name: shop.name ?? "", tagline: shop.tagline ?? "", description: shop.description ?? "",
    logoUrl: shop.logo_url ?? "", bannerUrl: shop.banner_url ?? "",
    shippingPolicy: shop.shipping_policy ?? "", returnPolicy: shop.return_policy ?? "",
    announcement: shop.announcement ?? "", onVacation: Boolean(shop.on_vacation),
    vacationMessage: shop.vacation_message ?? "", vacationUntil: shop.vacation_until ?? "",
  };
}

export function shopDraftError(draft: ShopDraft): string {
  if (draft.name.trim().length > SHOP_LIMITS.name) return `The shop name can be at most ${SHOP_LIMITS.name} characters.`;
  if (draft.tagline.trim().length > SHOP_LIMITS.tagline) return `The tagline can be at most ${SHOP_LIMITS.tagline} characters.`;
  if (draft.announcement.trim().length > SHOP_LIMITS.announcement) return `The announcement can be at most ${SHOP_LIMITS.announcement} characters.`;
  if (draft.vacationMessage.trim().length > SHOP_LIMITS.vacationMessage) return `The vacation message can be at most ${SHOP_LIMITS.vacationMessage} characters.`;
  if (draft.vacationUntil.trim() && !parseDay(draft.vacationUntil)) return "Enter the return date as YYYY-MM-DD, or leave it blank.";
  return "";
}

export function shopPayload(draft: ShopDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(), tagline: draft.tagline.trim(), description: draft.description.trim(),
    logo_url: draft.logoUrl, banner_url: draft.bannerUrl,
    shipping_policy: draft.shippingPolicy.trim(), return_policy: draft.returnPolicy.trim(),
    announcement: draft.announcement.trim(),
    on_vacation: draft.onVacation, vacation_message: draft.vacationMessage.trim(),
    vacation_until: draft.vacationUntil.trim() ? parseDay(draft.vacationUntil) : null,
  };
}

export const POLICY_FALLBACKS = {
  shipping: "This seller has not published a shipping policy. Ask them in a chat before you buy.",
  returns: "This seller has not published a return policy. Items are still covered by escrow: if something is not as described you can report a problem on your order.",
} as const;

export function policyText(text: string | null | undefined, kind: keyof typeof POLICY_FALLBACKS): string {
  return text?.trim() ? text.trim() : POLICY_FALLBACKS[kind];
}

/** What a buyer sees in place of the listings while the owner is away. */
export function vacationNotice(shop: Pick<MarketplaceShop, "vacation_message" | "vacation_until">): { title: string; body: string } {
  const until = shop.vacation_until ? parseDay(shop.vacation_until) : null;
  const back = until ? `Back on ${new Date(`${until}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" })}.` : "";
  return {
    title: "This shop is on vacation",
    body: [shop.vacation_message?.trim() || "The seller is away and is not taking orders right now.", back].filter(Boolean).join(" "),
  };
}

export function followerLabel(count: number): string {
  return `${count} ${count === 1 ? "follower" : "followers"}`;
}

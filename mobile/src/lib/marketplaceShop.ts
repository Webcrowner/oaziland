import { parseDay } from "./dateTimeInput";
import { translateEnglish, type Translate } from "../i18n/translate";
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

export function shopDraftError(draft: ShopDraft, t: Translate = translateEnglish): string {
  if (draft.name.trim().length > SHOP_LIMITS.name) return t("mkt.shop.errNameLength", { max: SHOP_LIMITS.name });
  if (draft.tagline.trim().length > SHOP_LIMITS.tagline) return t("mkt.shop.errTaglineLength", { max: SHOP_LIMITS.tagline });
  if (draft.announcement.trim().length > SHOP_LIMITS.announcement) return t("mkt.shop.errAnnouncementLength", { max: SHOP_LIMITS.announcement });
  if (draft.vacationMessage.trim().length > SHOP_LIMITS.vacationMessage) return t("mkt.shop.errVacationMessageLength", { max: SHOP_LIMITS.vacationMessage });
  if (draft.vacationUntil.trim() && !parseDay(draft.vacationUntil)) return t("mkt.shop.errReturnDate");
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

const POLICY_FALLBACK_KEYS = { shipping: "mkt.shop.policyShipping", returns: "mkt.shop.policyReturns" } as const;

export function policyText(text: string | null | undefined, kind: keyof typeof POLICY_FALLBACKS, t: Translate = translateEnglish): string {
  return text?.trim() ? text.trim() : t(POLICY_FALLBACK_KEYS[kind]);
}

/** What a buyer sees in place of the listings while the owner is away. */
export function vacationNotice(
  shop: Pick<MarketplaceShop, "vacation_message" | "vacation_until">, t: Translate = translateEnglish, locale?: string,
): { title: string; body: string } {
  const until = shop.vacation_until ? parseDay(shop.vacation_until) : null;
  const back = until ? t("mkt.shop.vacationBack", { date: new Date(`${until}T12:00:00`).toLocaleDateString(locale, { dateStyle: "medium" }) }) : "";
  return {
    title: t("mkt.shop.vacationTitle"),
    body: [shop.vacation_message?.trim() || t("mkt.shop.vacationDefaultMessage"), back].filter(Boolean).join(" "),
  };
}

export function followerLabel(count: number, t: Translate = translateEnglish): string {
  return t(count === 1 ? "mkt.shop.followerOne" : "mkt.shop.followerMany", { count });
}

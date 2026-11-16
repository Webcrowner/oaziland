import type { BoostOption, BoostUnit } from "./api";
import { translateEnglish, type Translate } from "../i18n/translate";

export const BOOST_UNIT_LABELS: Record<BoostUnit, { one: string; many: string }> = {
  DAILY: { one: "day", many: "days" },
  MONTHLY: { one: "month", many: "months" },
};

export function boostTotal(unitPriceXaf: number | string, quantity: number): number {
  return Number(unitPriceXaf) * quantity;
}

/** A whole number of units between 1 and the most one purchase allows. */
export function clampBoostQuantity(value: number, max: number): number {
  const whole = Math.floor(Number.isFinite(value) ? value : 1);
  return Math.min(Math.max(1, max), Math.max(1, whole));
}

export function boostLengthLabel(unit: BoostUnit, quantity: number, t: Translate = translateEnglish): string {
  return t(unit === "DAILY" ? (quantity === 1 ? "mkt.boost.daysOne" : "mkt.boost.daysMany") : (quantity === 1 ? "mkt.boost.monthsOne" : "mkt.boost.monthsMany"), { count: quantity });
}

export function boostOption(options: BoostOption[], unit: BoostUnit): BoostOption | undefined {
  return options.find((option) => option.duration_unit === unit);
}

/** "Expires <date>" for a live listing, "Expired" once it has lapsed; nothing when the date is unknown. */
export function expiryLabel(expiresAt: string | undefined, isExpired: boolean | undefined, t: Translate = translateEnglish, locale?: string): string {
  if (isExpired) return t("mkt.boost.expired");
  return expiresAt ? t("mkt.boost.expires", { date: new Date(expiresAt).toLocaleDateString(locale) }) : "";
}

export function statsLabel(stats: { views: number; saves: number; chats: number }, t: Translate = translateEnglish): string {
  const views = t(stats.views === 1 ? "mkt.boost.viewsOne" : "mkt.boost.viewsMany", { count: stats.views });
  const saves = t(stats.saves === 1 ? "mkt.boost.savesOne" : "mkt.boost.savesMany", { count: stats.saves });
  const chats = t(stats.chats === 1 ? "mkt.boost.chatsOne" : "mkt.boost.chatsMany", { count: stats.chats });
  return `👁 ${views} · ♥ ${saves} · 💬 ${chats}`;
}

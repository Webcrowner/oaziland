import type { BoostOption, BoostUnit } from "./api";

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

export function boostLengthLabel(unit: BoostUnit, quantity: number): string {
  const label = BOOST_UNIT_LABELS[unit];
  return `${quantity} ${quantity === 1 ? label.one : label.many}`;
}

export function boostOption(options: BoostOption[], unit: BoostUnit): BoostOption | undefined {
  return options.find((option) => option.duration_unit === unit);
}

/** "Expires <date>" for a live listing, "Expired" once it has lapsed; nothing when the date is unknown. */
export function expiryLabel(expiresAt: string | undefined, isExpired: boolean | undefined): string {
  if (isExpired) return "Expired";
  return expiresAt ? `Expires ${new Date(expiresAt).toLocaleDateString()}` : "";
}

export function statsLabel(stats: { views: number; saves: number; chats: number }): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `👁 ${count(stats.views, "view", "views")} · ♥ ${count(stats.saves, "save", "saves")} · 💬 ${count(stats.chats, "chat", "chats")}`;
}

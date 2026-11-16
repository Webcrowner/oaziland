import { formatMoment, parseMoment, MOMENT_FORMAT_HINT } from "./dateTimeInput";

export const MAX_SALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SaleFields {
  price_xaf: string;
  on_sale?: boolean;
  current_price_xaf?: string;
  sale_price_xaf?: string | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  compare_at_price_xaf?: string | null;
  has_variants?: boolean;
  price_from_xaf?: string | null;
}

/** A sale counts only while it has not run out, so a card left open past the end stops showing the old price. */
export function isOnSale(listing: SaleFields, now: number = Date.now()): boolean {
  if (!listing.on_sale) return false;
  return !listing.sale_ends_at || new Date(listing.sale_ends_at).getTime() > now;
}

/** What one unit costs right now. */
export function unitPriceXaf(listing: SaleFields, now: number = Date.now()): number {
  if (!isOnSale(listing, now)) return Number(listing.price_xaf);
  return Number(listing.current_price_xaf ?? listing.sale_price_xaf ?? listing.price_xaf);
}

/** "Ends in 2d 4h", "Ends in 5h 12m", and live seconds ("Ends in 12m 05s") in the last hour. */
export function countdownLabel(endsAt: string | null | undefined, now: number = Date.now()): string {
  if (!endsAt) return "";
  const remaining = new Date(endsAt).getTime() - now;
  if (Number.isNaN(remaining)) return "";
  if (remaining <= 0) return "Sale ended";
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `Ends in ${days}d ${hours}h`;
  if (hours > 0) return `Ends in ${hours}h ${minutes}m`;
  return `Ends in ${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
}

/** How long to wait before the label can next change: every second in the last hour, otherwise every 30 seconds. */
export function countdownTickMs(endsAt: string, now: number = Date.now()): number {
  return new Date(endsAt).getTime() - now <= 3600 * 1000 ? 1000 : 30000;
}

export interface SaleDraft {
  price: string;
  startsAt: string;
  endsAt: string;
}

export const EMPTY_SALE_DRAFT: SaleDraft = { price: "", startsAt: "", endsAt: "" };

export function saleDraftFrom(listing: { sale_price_xaf?: string | null; sale_starts_at?: string | null; sale_ends_at?: string | null }): SaleDraft {
  if (!listing.sale_price_xaf) return EMPTY_SALE_DRAFT;
  return { price: String(Number(listing.sale_price_xaf)), startsAt: formatMoment(listing.sale_starts_at), endsAt: formatMoment(listing.sale_ends_at) };
}

export function saleDraftFilled(draft: SaleDraft): boolean {
  return Boolean(draft.price.trim() || draft.startsAt.trim() || draft.endsAt.trim());
}

/** Mirrors the server rules (below the normal price, ends in the future, at most 30 days) so mistakes show before saving. */
export function saleDraftError(draft: SaleDraft, normalPriceXaf: number, now: number = Date.now()): string {
  const price = Number(draft.price);
  if (!draft.price.trim() || !Number.isFinite(price) || price <= 0) return "Enter the sale price in XAF.";
  if (Number.isFinite(normalPriceXaf) && price >= normalPriceXaf) return "The sale price must be below the normal price.";
  if (!draft.endsAt.trim()) return "Enter when the sale ends.";
  const ends = parseMoment(draft.endsAt, true);
  if (!ends) return `Enter the end as ${MOMENT_FORMAT_HINT}.`;
  const endTime = new Date(ends).getTime();
  if (endTime <= now) return "The sale must end in the future.";
  let startTime = now;
  if (draft.startsAt.trim()) {
    const starts = parseMoment(draft.startsAt);
    if (!starts) return `Enter the start as ${MOMENT_FORMAT_HINT}, or leave it blank to start now.`;
    startTime = new Date(starts).getTime();
    if (startTime >= endTime) return "The sale must start before it ends.";
  }
  if (endTime - startTime > MAX_SALE_DAYS * DAY_MS) return `A sale can run for at most ${MAX_SALE_DAYS} days.`;
  return "";
}

/** The PATCH body for a valid draft; a blank start is left out so the sale starts straight away. */
export function salePayload(draft: SaleDraft): Record<string, string> {
  const startsAt = parseMoment(draft.startsAt);
  return {
    sale_price_xaf: String(Math.round(Number(draft.price))),
    ...(startsAt ? { sale_starts_at: startsAt } : {}),
    sale_ends_at: parseMoment(draft.endsAt, true) ?? "",
  };
}

/** Sending all three as null ends a sale. */
export const CLEAR_SALE_PAYLOAD = { sale_price_xaf: null, sale_starts_at: null, sale_ends_at: null };

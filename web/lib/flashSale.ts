export type Countdown =
  | { kind: "ended" }
  | { kind: "days"; days: number; hours: number }
  | { kind: "hours"; hours: number; minutes: number }
  | { kind: "clock"; time: string };

const pad = (value: number) => String(value).padStart(2, "0");

/** How long is left, in the unit that reads best: days+hours, hours+minutes, then hh:mm:ss in the last hour. */
export function countdownParts(endsAt: string | Date, now: number = Date.now()): Countdown {
  const remaining = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return { kind: "ended" };
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days >= 1) return { kind: "days", days, hours };
  if (hours >= 1) return { kind: "hours", hours, minutes };
  return { kind: "clock", time: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` };
}

/** The countdown only needs a per-second tick in its last hour; before that a coarse tick is enough. */
export function countdownTickMs(endsAt: string | Date, now: number = Date.now()): number {
  return new Date(endsAt).getTime() - now <= 3600_000 ? 1000 : 30_000;
}

interface SaleFields {
  on_sale?: boolean;
  sale_ends_at?: string | null;
  sale_price_xaf?: string | null;
  price_xaf: string;
  current_price_xaf?: string;
}

/** A sale counts as running only while the server says so and its end hasn't passed on this device's clock. */
export function isSaleRunning(listing: Pick<SaleFields, "on_sale" | "sale_ends_at">, now: number = Date.now()): boolean {
  if (!listing.on_sale) return false;
  return !listing.sale_ends_at || new Date(listing.sale_ends_at).getTime() > now;
}

/** What one unit costs now: the server's current price while a sale runs, else the normal price. */
export function unitPriceXaf(listing: SaleFields, now: number = Date.now()): number {
  if (isSaleRunning(listing, now)) return Number(listing.current_price_xaf ?? listing.sale_price_xaf ?? listing.price_xaf);
  return Number(listing.price_xaf);
}

export function discountPercent(listPrice: number, salePrice: number): number {
  if (!(listPrice > 0) || salePrice >= listPrice) return 0;
  return Math.round((1 - salePrice / listPrice) * 100);
}

/** ISO timestamp -> the "YYYY-MM-DDTHH:mm" value of a datetime-local input, in the viewer's timezone. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A datetime-local value -> ISO timestamp, or null when blank or invalid. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

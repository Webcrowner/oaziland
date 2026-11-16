/** The whole-number percentage a buyer saves against the "was" price, rounded down: 8000 -> 6000 is 25. */
export function discountPercent(compareAt: number, price: number): number {
  if (!Number.isFinite(compareAt) || !Number.isFinite(price) || compareAt <= 0 || price < 0 || compareAt <= price) return 0;
  return Math.floor(((compareAt - price) * 100) / compareAt);
}

export interface CompareAtDisplay {
  amount: number;
  /** 0 when the saving is under 1%, so no badge is shown. */
  percent: number;
}

/** The struck-through "was" price for what is shown, or null unless it is above that price. */
export function compareAtDisplay(compareAt: string | number | null | undefined, price: number): CompareAtDisplay | null {
  if (compareAt === null || compareAt === undefined || compareAt === "") return null;
  const amount = Number(compareAt);
  if (!Number.isFinite(amount) || !Number.isFinite(price) || amount <= price) return null;
  return { amount, percent: discountPercent(amount, price) };
}

/** "-25%" for the badge, or "" when there is nothing worth showing. */
export function percentBadge(percent: number): string {
  return percent >= 1 ? `-${percent}%` : "";
}

/** The whole-number percentage a compare-at ("was") price is above the price shown, rounded down; 0 when it is not higher. */
export function compareAtPercent(compareAt: number, price: number): number {
  if (!(compareAt > 0) || !(price >= 0) || compareAt <= price) return 0;
  return Math.max(0, Math.floor(((compareAt - price) * 100) / compareAt + 1e-9));
}

/**
 * The struck-through "was" price to show next to `shownPrice`, or null when the listing has none that is higher.
 * While a flash sale runs, pass the pre-sale price as `originalPrice`: the compare-at price only replaces it when it is higher.
 */
export function compareAtDisplay(
  compareAtXaf: string | number | null | undefined,
  shownPrice: number,
  originalPrice?: number,
): { was: number; percent: number } | null {
  if (compareAtXaf === null || compareAtXaf === undefined || compareAtXaf === "") return null;
  const was = Number(compareAtXaf);
  if (!Number.isFinite(was) || was <= shownPrice) return null;
  if (originalPrice !== undefined && was <= originalPrice) return null;
  return { was, percent: compareAtPercent(was, shownPrice) };
}

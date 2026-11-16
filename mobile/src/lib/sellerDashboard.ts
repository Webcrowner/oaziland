import type { SellerDashboardSummary, SellerPeriod, SellerSeriesPoint } from "./api";
import { translateEnglish, type Translate } from "../i18n/translate";
import type { MessageKey } from "../i18n/messages";

export const SELLER_PERIODS: { key: SellerPeriod; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "365d", label: "1 year" },
  { key: "all", label: "All time" },
];

export const DEFAULT_SELLER_PERIOD: SellerPeriod = "30d";

export function periodLabel(period: SellerPeriod, t: Translate = translateEnglish): string {
  return t(`mkt.dash.period${period}` as MessageKey);
}

/** Money values arrive as strings of whole XAF. */
export function xaf(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatXaf(value: string | number | null | undefined): string {
  return `${Math.round(xaf(value)).toLocaleString("en-US")} XAF`;
}

/** Bar heights in pixels, scaled to the biggest net value; a non-zero value always shows at least `minHeight`. */
export function barHeights(points: Pick<SellerSeriesPoint, "net_xaf">[], maxHeight: number, minHeight = 3): number[] {
  const values = points.map((p) => Math.max(0, xaf(p.net_xaf)));
  const peak = Math.max(0, ...values);
  if (peak === 0) return values.map(() => 0);
  return values.map((v) => (v === 0 ? 0 : Math.max(minHeight, Math.round((v / peak) * maxHeight))));
}

/** Short axis label for a bucket date ("2026-11-15" or "2026-11"): "15 Nov" for days, "Nov 26" for months. */
export function bucketLabel(date: string, bucket: "day" | "month", t: Translate = translateEnglish): string {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(date);
  if (!match) return date;
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return date;
  const month = t(`mkt.dash.month${monthNumber}` as MessageKey);
  if (bucket === "month") return `${month} ${match[1].slice(2)}`;
  return `${Number(match[3] ?? 1)} ${month}`;
}

/** Which bars get an axis label so a long series stays readable (at most about `max` labels). */
export function labelEvery(count: number, max = 6): number {
  return Math.max(1, Math.ceil(count / max));
}

/** Platform fee as a percentage of gross sales, one decimal, 0 when nothing was sold. */
export function feePercent(summary: Pick<SellerDashboardSummary, "gross_sales_xaf" | "platform_fees_xaf">): number {
  const gross = xaf(summary.gross_sales_xaf);
  if (gross <= 0) return 0;
  return Math.round((xaf(summary.platform_fees_xaf) / gross) * 1000) / 10;
}

export interface NetBreakdown {
  gross: number;
  fees: number;
  refunds: number;
  net: number;
  feePct: number;
}

export function netBreakdown(summary: SellerDashboardSummary): NetBreakdown {
  return {
    gross: xaf(summary.gross_sales_xaf),
    fees: xaf(summary.platform_fees_xaf),
    refunds: xaf(summary.refunded_xaf),
    net: xaf(summary.net_earnings_xaf),
    feePct: feePercent(summary),
  };
}

export function viewsLabel(views: number, conversionPct: number | null, t: Translate = translateEnglish): string {
  const base = t(views === 1 ? "mkt.dash.viewsOne" : "mkt.dash.viewsMany", { count: views.toLocaleString("en-US") });
  return conversionPct === null ? base : t("mkt.dash.viewsConversion", { base, pct: conversionPct });
}

export function salesCsvTitle(period: SellerPeriod, t: Translate = translateEnglish): string {
  return t("mkt.dash.csvTitle", { period: periodLabel(period, t) });
}

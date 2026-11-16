import type { MarketplaceReturnRequest, MarketplaceShipmentStatus, SellerDashboard } from "@/lib/api";

const SHIPMENT_ORDER: MarketplaceShipmentStatus[] = ["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"];

/** Shipment statuses can only move forward, so only the steps after the current one are offered. */
export function nextShipmentStatuses(current: MarketplaceShipmentStatus | "" | undefined): MarketplaceShipmentStatus[] {
  const index = current ? SHIPMENT_ORDER.indexOf(current) : -1;
  return SHIPMENT_ORDER.slice(index + 1);
}

export function isReturnOpen(request: MarketplaceReturnRequest | null | undefined): boolean {
  return request?.status === "REQUESTED" || request?.status === "REJECTED";
}

export function isPast(iso: string | null | undefined, now: Date = new Date()): boolean {
  return Boolean(iso) && new Date(iso as string) <= now;
}

export function feeBreakdown(summary: Pick<SellerDashboard["summary"], "gross_sales_xaf" | "platform_fees_xaf" | "refunded_xaf" | "net_earnings_xaf">) {
  const gross = Number(summary.gross_sales_xaf) || 0;
  const fees = Number(summary.platform_fees_xaf) || 0;
  return {
    gross,
    fees,
    refunded: Number(summary.refunded_xaf) || 0,
    net: Number(summary.net_earnings_xaf) || 0,
    feePct: gross > 0 ? Math.round((fees / gross) * 1000) / 10 : 0,
  };
}

/** Bar heights as a percentage of the tallest bucket; a non-zero bucket is never drawn flat. */
export function chartBars(points: { net_xaf: string }[]): number[] {
  const values = points.map((point) => Math.max(0, Number(point.net_xaf) || 0));
  const max = Math.max(0, ...values);
  return values.map((value) => (max === 0 || value === 0 ? 0 : Math.max(2, Math.round((value / max) * 100))));
}

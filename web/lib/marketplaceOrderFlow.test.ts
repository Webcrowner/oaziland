import { describe, expect, it } from "vitest";
import { chartBars, feeBreakdown, isPast, isReturnOpen, nextShipmentStatuses } from "./marketplaceOrderFlow";
import { filenameFromContentDisposition, type MarketplaceReturnRequest } from "./api";

describe("nextShipmentStatuses", () => {
  it("offers every step before the first update", () => {
    expect(nextShipmentStatuses("")).toEqual(["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"]);
  });

  it("only offers steps after the current one", () => {
    expect(nextShipmentStatuses("IN_TRANSIT")).toEqual(["OUT_FOR_DELIVERY", "DELIVERED"]);
    expect(nextShipmentStatuses("DELIVERED")).toEqual([]);
  });
});

describe("isReturnOpen", () => {
  it("is open while requested or rejected", () => {
    const base = { status: "REQUESTED" } as MarketplaceReturnRequest;
    expect(isReturnOpen(base)).toBe(true);
    expect(isReturnOpen({ ...base, status: "REJECTED" })).toBe(true);
    expect(isReturnOpen({ ...base, status: "ESCALATED" })).toBe(false);
    expect(isReturnOpen(null)).toBe(false);
  });
});

describe("isPast", () => {
  it("compares against the given moment and tolerates null", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(isPast("2026-01-09T12:00:00Z", now)).toBe(true);
    expect(isPast("2026-01-11T12:00:00Z", now)).toBe(false);
    expect(isPast(null, now)).toBe(false);
  });
});

describe("feeBreakdown", () => {
  it("computes the platform fee as a share of gross sales", () => {
    const result = feeBreakdown({ gross_sales_xaf: "200000", platform_fees_xaf: "10000", refunded_xaf: "5000", net_earnings_xaf: "185000" });
    expect(result).toEqual({ gross: 200000, fees: 10000, refunded: 5000, net: 185000, feePct: 5 });
  });

  it("does not divide by zero", () => {
    expect(feeBreakdown({ gross_sales_xaf: "0", platform_fees_xaf: "0", refunded_xaf: "0", net_earnings_xaf: "0" }).feePct).toBe(0);
  });
});

describe("chartBars", () => {
  it("scales to the tallest bucket and keeps small values visible", () => {
    expect(chartBars([{ net_xaf: "1000" }, { net_xaf: "500" }, { net_xaf: "1" }, { net_xaf: "0" }])).toEqual([100, 50, 2, 0]);
  });

  it("is flat when nothing was earned", () => {
    expect(chartBars([{ net_xaf: "0" }])).toEqual([0]);
  });
});

describe("filenameFromContentDisposition", () => {
  it("reads the file name or falls back", () => {
    expect(filenameFromContentDisposition('attachment; filename="sales-30d.csv"', "x.csv")).toBe("sales-30d.csv");
    expect(filenameFromContentDisposition(null, "x.csv")).toBe("x.csv");
  });
});

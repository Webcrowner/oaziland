import { barHeights, bucketLabel, feePercent, formatXaf, labelEvery, netBreakdown, viewsLabel } from "../sellerDashboard";
import type { SellerDashboardSummary } from "../api";

const summary = {
  gross_sales_xaf: "200000", platform_fees_xaf: "10000", refunded_xaf: "20000", net_earnings_xaf: "170000",
} as SellerDashboardSummary;

describe("barHeights", () => {
  it("scales to the tallest net value and keeps tiny values visible", () => {
    expect(barHeights([{ net_xaf: "1000" }, { net_xaf: "500" }, { net_xaf: "1" }, { net_xaf: "0" }], 100)).toEqual([100, 50, 3, 0]);
  });

  it("draws nothing when there are no earnings", () => {
    expect(barHeights([{ net_xaf: "0" }, { net_xaf: "0" }], 100)).toEqual([0, 0]);
    expect(barHeights([], 100)).toEqual([]);
  });
});

describe("bucketLabel", () => {
  it("labels days and months", () => {
    expect(bucketLabel("2026-11-05", "day")).toBe("5 Nov");
    expect(bucketLabel("2026-03-01", "month")).toBe("Mar 26");
    expect(bucketLabel("2026-03", "month")).toBe("Mar 26");
    expect(bucketLabel("junk", "day")).toBe("junk");
  });

  it("spaces axis labels on long series", () => {
    expect(labelEvery(5)).toBe(1);
    expect(labelEvery(30)).toBe(5);
    expect(labelEvery(0)).toBe(1);
  });
});

describe("fees", () => {
  it("computes the fee as a percentage of gross sales", () => {
    expect(feePercent(summary)).toBe(5);
    expect(feePercent({ gross_sales_xaf: "0", platform_fees_xaf: "0" })).toBe(0);
    expect(feePercent({ gross_sales_xaf: "30000", platform_fees_xaf: "1000" })).toBe(3.3);
  });

  it("breaks gross down into net", () => {
    const b = netBreakdown(summary);
    expect(b.gross - b.fees - b.refunds).toBe(b.net);
    expect(b.feePct).toBe(5);
  });
});

describe("formatting", () => {
  it("formats money and views", () => {
    expect(formatXaf("12500")).toBe("12,500 XAF");
    expect(formatXaf(null)).toBe("0 XAF");
    expect(viewsLabel(1, null)).toBe("1 view");
    expect(viewsLabel(120, 2.5)).toBe("120 views · 2.5% conversion");
  });
});

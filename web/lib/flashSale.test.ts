import { describe, expect, it } from "vitest";
import { countdownParts, countdownTickMs, discountPercent, isSaleRunning, isoToLocalInput, localInputToIso, unitPriceXaf } from "./flashSale";

const NOW = Date.parse("2026-05-01T10:00:00Z");
const after = (ms: number) => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("countdownParts", () => {
  it("shows days and hours when more than a day is left", () => {
    expect(countdownParts(after(2 * DAY + 4 * HOUR + 5 * MIN), NOW)).toEqual({ kind: "days", days: 2, hours: 4 });
  });

  it("shows hours and minutes from one hour up to a day", () => {
    expect(countdownParts(after(5 * HOUR + 30 * MIN), NOW)).toEqual({ kind: "hours", hours: 5, minutes: 30 });
    expect(countdownParts(after(DAY - 1000), NOW)).toEqual({ kind: "hours", hours: 23, minutes: 59 });
  });

  it("switches to a zero-padded clock in the last hour", () => {
    expect(countdownParts(after(42 * MIN + 9_000), NOW)).toEqual({ kind: "clock", time: "00:42:09" });
    expect(countdownParts(after(HOUR - 1000), NOW)).toEqual({ kind: "clock", time: "00:59:59" });
  });

  it("reports ended at or after the end and for invalid dates", () => {
    expect(countdownParts(after(0), NOW)).toEqual({ kind: "ended" });
    expect(countdownParts(after(-5000), NOW)).toEqual({ kind: "ended" });
    expect(countdownParts("not a date", NOW)).toEqual({ kind: "ended" });
  });
});

describe("countdownTickMs", () => {
  it("ticks every second only in the last hour", () => {
    expect(countdownTickMs(after(30 * MIN), NOW)).toBe(1000);
    expect(countdownTickMs(after(3 * HOUR), NOW)).toBe(30_000);
  });
});

describe("sale pricing", () => {
  const sale = { price_xaf: "10000", sale_price_xaf: "7500", current_price_xaf: "7500", on_sale: true, sale_ends_at: after(HOUR) };

  it("uses the current price while the sale runs", () => {
    expect(isSaleRunning(sale, NOW)).toBe(true);
    expect(unitPriceXaf(sale, NOW)).toBe(7500);
  });

  it("falls back to the normal price once the end has passed locally", () => {
    expect(isSaleRunning(sale, NOW + 2 * HOUR)).toBe(false);
    expect(unitPriceXaf(sale, NOW + 2 * HOUR)).toBe(10000);
  });

  it("ignores a sale the server does not report as running", () => {
    expect(unitPriceXaf({ ...sale, on_sale: false, current_price_xaf: "10000" }, NOW)).toBe(10000);
  });

  it("rounds the discount percentage and returns 0 when there is no discount", () => {
    expect(discountPercent(10000, 7500)).toBe(25);
    expect(discountPercent(3000, 2000)).toBe(33);
    expect(discountPercent(1000, 1000)).toBe(0);
    expect(discountPercent(0, 0)).toBe(0);
  });
});

describe("datetime-local conversion", () => {
  it("round-trips a local value through ISO", () => {
    const iso = localInputToIso("2026-06-01T18:30");
    expect(iso).not.toBeNull();
    expect(isoToLocalInput(iso)).toBe("2026-06-01T18:30");
  });

  it("returns blanks for empty or invalid input", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("nope")).toBeNull();
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("nope")).toBe("");
  });
});

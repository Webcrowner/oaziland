import {
  CLEAR_SALE_PAYLOAD, countdownLabel, countdownTickMs, isOnSale, saleDraftError, saleDraftFrom, salePayload, unitPriceXaf,
} from "../flashSale";

const NOW = new Date(2030, 0, 10, 12, 0, 0).getTime();
const at = (ms: number) => new Date(NOW + ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("countdownLabel", () => {
  it("shows days and hours, then hours and minutes", () => {
    expect(countdownLabel(at(2 * DAY + 4 * HOUR + 5 * MIN), NOW)).toBe("Ends in 2d 4h");
    expect(countdownLabel(at(5 * HOUR + 12 * MIN), NOW)).toBe("Ends in 5h 12m");
  });

  it("counts live seconds in the last hour", () => {
    expect(countdownLabel(at(12 * MIN + 5 * 1000), NOW)).toBe("Ends in 12m 05s");
    expect(countdownTickMs(at(30 * MIN), NOW)).toBe(1000);
    expect(countdownTickMs(at(3 * HOUR), NOW)).toBe(30000);
  });

  it("reports an ended sale", () => {
    expect(countdownLabel(at(-1000), NOW)).toBe("Sale ended");
    expect(countdownLabel(null, NOW)).toBe("");
  });
});

describe("unit price", () => {
  const sale = { price_xaf: "10000", on_sale: true, current_price_xaf: "7500", sale_price_xaf: "7500", sale_ends_at: at(HOUR) };

  it("uses the sale price while the sale runs", () => {
    expect(isOnSale(sale, NOW)).toBe(true);
    expect(unitPriceXaf(sale, NOW)).toBe(7500);
  });

  it("goes back to the normal price once the sale has run out", () => {
    const lapsed = { ...sale, sale_ends_at: at(-MIN) };
    expect(isOnSale(lapsed, NOW)).toBe(false);
    expect(unitPriceXaf(lapsed, NOW)).toBe(10000);
    expect(unitPriceXaf({ price_xaf: "10000", on_sale: false }, NOW)).toBe(10000);
  });
});

describe("saleDraftError", () => {
  const draft = { price: "7000", startsAt: "", endsAt: "2030-01-20 18:00" };

  it("accepts a valid sale", () => {
    expect(saleDraftError(draft, 10000, NOW)).toBe("");
  });

  it("applies the server rules", () => {
    expect(saleDraftError({ ...draft, price: "10000" }, 10000, NOW)).toMatch(/below the normal price/);
    expect(saleDraftError({ ...draft, endsAt: "" }, 10000, NOW)).toMatch(/when the sale ends/);
    expect(saleDraftError({ ...draft, endsAt: "2030-01-09 10:00" }, 10000, NOW)).toMatch(/end in the future/);
    expect(saleDraftError({ ...draft, endsAt: "2030-03-01 10:00" }, 10000, NOW)).toMatch(/at most 30 days/);
    expect(saleDraftError({ ...draft, startsAt: "2030-01-21 10:00" }, 10000, NOW)).toMatch(/start before it ends/);
  });
});

describe("sale payloads", () => {
  it("leaves out a blank start so the sale starts now", () => {
    const payload = salePayload({ price: "7000", startsAt: "", endsAt: "2030-01-20 18:00" });
    expect(payload.sale_price_xaf).toBe("7000");
    expect(payload).not.toHaveProperty("sale_starts_at");
    expect(payload.sale_ends_at).toBe(new Date(2030, 0, 20, 18, 0).toISOString());
  });

  it("round-trips a stored sale into the editor and clears with three nulls", () => {
    const stored = { sale_price_xaf: "7000.00", sale_starts_at: null, sale_ends_at: new Date(2030, 0, 20, 18, 0).toISOString() };
    expect(saleDraftFrom(stored)).toEqual({ price: "7000", startsAt: "", endsAt: "2030-01-20 18:00" });
    expect(CLEAR_SALE_PAYLOAD).toEqual({ sale_price_xaf: null, sale_starts_at: null, sale_ends_at: null });
  });
});

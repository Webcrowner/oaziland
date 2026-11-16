import { describe, expect, it } from "vitest";
import { couponDiscount, couponStatus, normalizeCouponCode } from "./coupons";

const NOW = Date.parse("2026-05-01T10:00:00Z");
const base = { is_active: true, starts_at: null, expires_at: null, max_uses: null, uses: 0 };

describe("normalizeCouponCode", () => {
  it("uppercases and strips characters the API rejects", () => {
    expect(normalizeCouponCode(" ete-25 !% ")).toBe("ETE-25");
    expect(normalizeCouponCode("a".repeat(40))).toHaveLength(30);
  });
});

describe("couponStatus", () => {
  it("is active with no limits", () => {
    expect(couponStatus(base, NOW)).toBe("active");
  });

  it("reports the reason a coupon cannot be used", () => {
    expect(couponStatus({ ...base, is_active: false }, NOW)).toBe("inactive");
    expect(couponStatus({ ...base, expires_at: "2026-04-30T00:00:00Z" }, NOW)).toBe("expired");
    expect(couponStatus({ ...base, starts_at: "2026-05-02T00:00:00Z" }, NOW)).toBe("scheduled");
    expect(couponStatus({ ...base, max_uses: 5, uses: 5 }, NOW)).toBe("exhausted");
  });

  it("stays active before the limits are reached", () => {
    expect(couponStatus({ ...base, max_uses: 5, uses: 4, expires_at: "2026-06-01T00:00:00Z" }, NOW)).toBe("active");
  });
});

describe("couponDiscount", () => {
  it("rounds decimal strings from the API", () => {
    expect(couponDiscount({ kind: "PERCENT", value: "15.00" })).toEqual({ kind: "PERCENT", amount: 15 });
    expect(couponDiscount({ kind: "FIXED", value: "2000.00" })).toEqual({ kind: "FIXED", amount: 2000 });
  });
});

import type { MarketplaceCoupon } from "../api";
import {
  couponDiscountLabel, couponDraftError, couponPayload, couponStatusLabel, EMPTY_COUPON_DRAFT, type CouponDraft,
} from "../marketplaceCoupons";

const NOW = new Date(2030, 0, 10, 12, 0).getTime();
const draft: CouponDraft = { ...EMPTY_COUPON_DRAFT, code: " welcome10 ", value: "10" };

describe("couponDraftError", () => {
  it("accepts a simple percent coupon", () => {
    expect(couponDraftError(draft, NOW)).toBe("");
  });

  it("checks the code and the discount range", () => {
    expect(couponDraftError({ ...draft, code: "ab" }, NOW)).toMatch(/3 to 30/);
    expect(couponDraftError({ ...draft, code: "no spaces" }, NOW)).toMatch(/3 to 30/);
    expect(couponDraftError({ ...draft, value: "95" }, NOW)).toMatch(/at most 90%/);
    expect(couponDraftError({ ...draft, value: "" }, NOW)).toMatch(/percentage/);
    expect(couponDraftError({ ...draft, kind: "FIXED", value: "" }, NOW)).toMatch(/XAF/);
  });

  it("checks optional limits and dates", () => {
    expect(couponDraftError({ ...draft, maxUses: "0" }, NOW)).toMatch(/Maximum uses/);
    expect(couponDraftError({ ...draft, expiresAt: "2030-01-01" }, NOW)).toMatch(/in the future/);
    expect(couponDraftError({ ...draft, startsAt: "2030-02-01", expiresAt: "2030-01-20" }, NOW)).toMatch(/start before/);
  });
});

describe("couponPayload", () => {
  it("uppercases the code and turns blanks into unlimited or no date", () => {
    expect(couponPayload(draft)).toEqual({
      code: "WELCOME10", kind: "PERCENT", value: 10, min_order_xaf: 0, max_uses: null, starts_at: null, expires_at: null,
    });
  });
});

describe("coupon labels", () => {
  const coupon: MarketplaceCoupon = {
    id: "1", code: "SAVE", kind: "FIXED", value: "2000", min_order_xaf: "10000", max_uses: 5, uses: 2,
    starts_at: null, expires_at: null, is_active: true,
  };

  it("describes the discount and its minimum order", () => {
    expect(couponDiscountLabel({ kind: "PERCENT", value: "15", min_order_xaf: "0" })).toBe("15% off");
    expect(couponDiscountLabel(coupon)).toMatch(/^2,?000 XAF off orders over 10,?000 XAF$/);
  });

  it("explains whether it can be used now", () => {
    expect(couponStatusLabel(coupon, NOW)).toBe("2/5 used · Valid");
    expect(couponStatusLabel({ ...coupon, is_active: false }, NOW)).toMatch(/Switched off/);
    expect(couponStatusLabel({ ...coupon, uses: 5 }, NOW)).toMatch(/Used up/);
    expect(couponStatusLabel({ ...coupon, max_uses: null, expires_at: new Date(NOW - 1000).toISOString() }, NOW)).toMatch(/^2 used · Expired/);
  });
});

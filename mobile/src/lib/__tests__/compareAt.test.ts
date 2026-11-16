import { compareAtDisplay, discountPercent, percentBadge } from "../compareAt";

describe("discountPercent", () => {
  it("rounds the saving down to a whole percent", () => {
    expect(discountPercent(8000, 6000)).toBe(25);
    expect(discountPercent(3, 2)).toBe(33);
    expect(discountPercent(1000, 999)).toBe(0);
  });

  it("is zero when the original price is not above the price", () => {
    expect(discountPercent(5000, 5000)).toBe(0);
    expect(discountPercent(4000, 5000)).toBe(0);
    expect(discountPercent(0, 0)).toBe(0);
    expect(discountPercent(NaN, 100)).toBe(0);
  });
});

describe("compareAtDisplay", () => {
  it("shows the struck price only while it is above the price shown", () => {
    expect(compareAtDisplay("8000.00", 6000)).toEqual({ amount: 8000, percent: 25 });
    expect(compareAtDisplay("8000.00", 8000)).toBeNull();
    expect(compareAtDisplay("8000.00", 9000)).toBeNull();
  });

  it("shows nothing without an original price", () => {
    expect(compareAtDisplay(null, 6000)).toBeNull();
    expect(compareAtDisplay(undefined, 6000)).toBeNull();
    expect(compareAtDisplay("", 6000)).toBeNull();
  });
});

describe("percentBadge", () => {
  it("hides a saving under one percent", () => {
    expect(percentBadge(25)).toBe("-25%");
    expect(percentBadge(0)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { compareAtDisplay, compareAtPercent } from "./comparePrice";

describe("compareAtPercent", () => {
  it("rounds down", () => {
    expect(compareAtPercent(8000, 6000)).toBe(25);
    expect(compareAtPercent(3000, 2000)).toBe(33);
    expect(compareAtPercent(10000, 9999)).toBe(0);
  });

  it("is 0 when the was price is not higher", () => {
    expect(compareAtPercent(5000, 5000)).toBe(0);
    expect(compareAtPercent(4000, 5000)).toBe(0);
    expect(compareAtPercent(0, 0)).toBe(0);
  });
});

describe("compareAtDisplay", () => {
  it("returns the was price and percentage when higher than the shown price", () => {
    expect(compareAtDisplay("8000.00", 6000)).toEqual({ was: 8000, percent: 25 });
  });

  it("returns null without a compare-at price or when it is not higher", () => {
    expect(compareAtDisplay(null, 6000)).toBeNull();
    expect(compareAtDisplay(undefined, 6000)).toBeNull();
    expect(compareAtDisplay("6000.00", 6000)).toBeNull();
  });

  it("only beats the pre-sale price when higher during a flash sale", () => {
    expect(compareAtDisplay("8000", 5000, 9000)).toBeNull();
    expect(compareAtDisplay("12000", 5000, 9000)).toEqual({ was: 12000, percent: 58 });
  });
});

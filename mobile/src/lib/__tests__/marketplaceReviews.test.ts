import { distributionPercents, starString } from "../marketplaceReviews";

describe("review helpers", () => {
  it("draws filled and empty stars", () => {
    expect(starString(4)).toBe("★★★★☆");
    expect(starString(4.6)).toBe("★★★★★");
    expect(starString(0)).toBe("☆☆☆☆☆");
  });

  it("turns the distribution into percentages and copes with no reviews", () => {
    expect(distributionPercents({ "5": 3, "4": 1 }, 4)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 25, 5: 75 });
    expect(distributionPercents({}, 0)).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });
});

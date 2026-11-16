import { boostLengthLabel, boostTotal, clampBoostQuantity, expiryLabel, statsLabel } from "../marketplaceBoost";

describe("boost pricing", () => {
  it("multiplies the unit price by the quantity", () => {
    expect(boostTotal("500.00", 7)).toBe(3500);
    expect(boostTotal(2000, 3)).toBe(6000);
  });

  it("keeps the quantity within one purchase's limits", () => {
    expect(clampBoostQuantity(0, 30)).toBe(1);
    expect(clampBoostQuantity(99, 30)).toBe(30);
    expect(clampBoostQuantity(2.9, 3)).toBe(2);
    expect(clampBoostQuantity(NaN, 3)).toBe(1);
  });

  it("pluralises the length", () => {
    expect(boostLengthLabel("DAILY", 1)).toBe("1 day");
    expect(boostLengthLabel("MONTHLY", 3)).toBe("3 months");
  });
});

describe("my listings labels", () => {
  it("says Expired once lapsed and nothing without a date", () => {
    expect(expiryLabel("2030-01-01T00:00:00Z", true)).toBe("Expired");
    expect(expiryLabel(undefined, false)).toBe("");
    expect(expiryLabel("2030-01-01T12:00:00Z", false)).toMatch(/^Expires /);
  });

  it("summarises the stats", () => {
    expect(statsLabel({ views: 12, saves: 3, chats: 1 })).toBe("👁 12 views · ♥ 3 saves · 💬 1 chat");
  });
});

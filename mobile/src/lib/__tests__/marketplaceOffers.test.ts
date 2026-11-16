import { canMakeOffer, counterAmountError, offerActions, offerAmountError, offerCurrentAmount, offerStatusLabel, parseAmount } from "../marketplaceOffers";

describe("offer actions", () => {
  it("lets the seller answer a pending offer and nothing else", () => {
    expect(offerActions("PENDING", "selling")).toEqual(["accept", "counter", "decline"]);
    expect(offerActions("COUNTERED", "selling")).toEqual([]);
    expect(offerActions("ACCEPTED", "selling")).toEqual([]);
  });

  it("lets the buyer accept a counter, withdraw, or pay an accepted offer", () => {
    expect(offerActions("COUNTERED", "buying")).toEqual(["accept", "withdraw"]);
    expect(offerActions("PENDING", "buying")).toEqual(["withdraw"]);
    expect(offerActions("ACCEPTED", "buying")).toEqual(["pay", "withdraw"]);
    expect(offerActions("DECLINED", "buying")).toEqual([]);
  });

  it("words a status from the viewer's side", () => {
    expect(offerStatusLabel("PENDING", "selling")).toBe("Waiting for your answer");
    expect(offerStatusLabel("PENDING", "buying")).toBe("Waiting for the seller");
  });
});

describe("offer amounts", () => {
  it("parses only positive whole numbers", () => {
    expect(parseAmount("12 500")).toBe(12500);
    expect(parseAmount("12.5")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("applies the server's rules for a buyer's offer", () => {
    expect(offerAmountError("70000", 100000)).toBe("");
    expect(offerAmountError("100000", 100000)).toMatch(/at or above/);
    expect(offerAmountError("29999", 100000)).toMatch(/at least 30%/);
    expect(offerAmountError("abc", 100000)).toMatch(/Enter your offer/);
  });

  it("keeps a counter-offer strictly between the offer and the asking price", () => {
    expect(counterAmountError("85000", 70000, 100000)).toBe("");
    expect(counterAmountError("70000", 70000, 100000)).toMatch(/between/);
    expect(counterAmountError("100000", 70000, 100000)).toMatch(/between/);
  });

  it("shows the agreed price once accepted, the counter while countered", () => {
    const base = { amount_xaf: "70000", counter_amount_xaf: "85000", agreed_amount_xaf: null };
    expect(offerCurrentAmount({ ...base, status: "COUNTERED" })).toBe(85000);
    expect(offerCurrentAmount({ ...base, status: "ACCEPTED", agreed_amount_xaf: "85000" })).toBe(85000);
    expect(offerCurrentAmount({ ...base, status: "PENDING" })).toBe(70000);
  });
});

describe("canMakeOffer", () => {
  const listing = { allow_offers: true, availability_status: "AVAILABLE", price_basis: "SALE" };

  it("allows a buyer on an available listing that takes offers", () => {
    expect(canMakeOffer(listing, "goods", false)).toBe(true);
  });

  it("refuses the lister, unavailable listings, listings without offers and dated car rentals", () => {
    expect(canMakeOffer(listing, "goods", true)).toBe(false);
    expect(canMakeOffer({ ...listing, availability_status: "UNDER_OFFER" }, "goods", false)).toBe(false);
    expect(canMakeOffer({ ...listing, allow_offers: false }, "goods", false)).toBe(false);
    expect(canMakeOffer({ ...listing, price_basis: "RENT_NIGHTLY" }, "cars", false)).toBe(false);
    expect(canMakeOffer({ ...listing, price_basis: "RENT_NIGHTLY" }, "warehouses", false)).toBe(true);
  });

  it("refuses items with options, whose price depends on the version", () => {
    expect(canMakeOffer({ ...listing, has_variants: true }, "goods", false)).toBe(false);
    expect(canMakeOffer({ ...listing, has_variants: false }, "goods", false)).toBe(true);
  });
});

import { EMPTY_GOODS_DRAFT, goodsDraftError, goodsPayload, listingErrorText, type GoodsDraft } from "../goodsListing";

const ready: GoodsDraft = { ...EMPTY_GOODS_DRAFT, title: " Sofa ", itemCategory: "HOME", price: "45000", quarterId: "q1" };

describe("goodsDraftError", () => {
  it("accepts a complete draft with pickup only", () => {
    expect(goodsDraftError(ready)).toBeNull();
  });

  it("asks for each required field in turn", () => {
    expect(goodsDraftError({ ...ready, title: "  " })).toBe("goods.error.title");
    expect(goodsDraftError({ ...ready, itemCategory: "" })).toBe("goods.error.category");
    expect(goodsDraftError({ ...ready, price: "0" })).toBe("goods.error.price");
    expect(goodsDraftError({ ...ready, quantity: "1.5" })).toBe("goods.error.quantity");
    expect(goodsDraftError({ ...ready, quantity: "100001" })).toBe("goods.error.quantity");
    expect(goodsDraftError({ ...ready, quarterId: "" })).toBe("goods.error.quarter");
  });

  it("only accepts an original price above the selling price", () => {
    expect(goodsDraftError({ ...ready, compareAt: "60000" })).toBeNull();
    expect(goodsDraftError({ ...ready, compareAt: "45000" })).toBe("goods.error.compareAt");
    expect(goodsDraftError({ ...ready, compareAt: "abc" })).toBe("goods.error.compareAt");
    expect(goodsDraftError({ ...ready, compareAt: "  " })).toBeNull();
  });

  it("needs at least one way for the buyer to get the item", () => {
    expect(goodsDraftError({ ...ready, pickup: false })).toBe("goods.error.delivery");
    expect(goodsDraftError({ ...ready, pickup: false, courier: true })).toBeNull();
  });

  it("only checks the fee of a delivery option that is switched on", () => {
    expect(goodsDraftError({ ...ready, sellerDelivery: true, sellerFee: "-5" })).toBe("goods.error.fee");
    expect(goodsDraftError({ ...ready, sellerDelivery: false, sellerFee: "-5" })).toBeNull();
  });
});

describe("goodsPayload", () => {
  it("sends the original price only when one is entered", () => {
    expect(goodsPayload(ready, null)).not.toHaveProperty("compare_at_price_xaf");
    expect(goodsPayload({ ...ready, compareAt: " 60000 " }, null)).toMatchObject({ compare_at_price_xaf: "60000" });
  });

  it("sends trimmed text, a sale price and the location", () => {
    const body = goodsPayload(ready, { latitude: 4.05, longitude: 9.7 });
    expect(body).toMatchObject({ title: "Sofa", price_basis: "SALE", item_category: "HOME", quantity: 1, quarter: "q1", latitude: 4.05, longitude: 9.7 });
  });

  it("zeroes the fees of delivery options that are off", () => {
    const body = goodsPayload({ ...ready, sellerFee: "2000", sellerAreas: "Bonamoussadi", courierFee: "3000", courierNote: "Bus" }, null);
    expect(body).toMatchObject({
      seller_delivery: false, seller_delivery_fee_xaf: "0", seller_delivery_areas: "",
      courier_shipping: false, courier_fee_xaf: "0", courier_note: "", latitude: null,
    });
  });

  it("keeps the fee of a delivery option that is on", () => {
    const body = goodsPayload({ ...ready, sellerDelivery: true, sellerFee: " 2000 ", sellerAreas: "Akwa" }, null);
    expect(body).toMatchObject({ seller_delivery: true, seller_delivery_fee_xaf: "2000", seller_delivery_areas: "Akwa" });
  });
});

describe("listingErrorText", () => {
  it("reads the first field message from the server's JSON", () => {
    expect(listingErrorText(new Error(JSON.stringify({ price_xaf: ["Too low."] })), "fallback")).toBe("Too low.");
    expect(listingErrorText(new Error(JSON.stringify({ detail: "Complete your identity check first." })), "fallback")).toBe("Complete your identity check first.");
  });

  it("falls back for anything else", () => {
    expect(listingErrorText(new Error("Network request failed"), "fallback")).toBe("fallback");
    expect(listingErrorText("boom", "fallback")).toBe("fallback");
  });
});

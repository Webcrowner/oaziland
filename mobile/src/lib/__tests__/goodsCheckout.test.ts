import { clampQuantity, deliveryOptions, goodsTotal } from "../goodsCheckout";

const base = { pickup_available: false, seller_delivery: false, seller_delivery_fee_xaf: null, courier_shipping: false, courier_fee_xaf: null };

describe("deliveryOptions", () => {
  it("lists only what the seller offers, with each fee", () => {
    expect(deliveryOptions({ ...base, pickup_available: true, courier_shipping: true, courier_fee_xaf: "2500.00" })).toEqual([
      { method: "PICKUP", feeXaf: 0, label: "Pick it up" },
      { method: "COURIER", feeXaf: 2500, label: "Courier shipping" },
    ]);
    expect(deliveryOptions(base)).toEqual([]);
  });
});

describe("clampQuantity and goodsTotal", () => {
  it("keeps the quantity between one and the stock", () => {
    expect(clampQuantity(0, 5)).toBe(1);
    expect(clampQuantity(9, 5)).toBe(5);
    expect(clampQuantity(2.7, 5)).toBe(2);
    expect(clampQuantity(Number.NaN, 5)).toBe(1);
  });

  it("charges price × quantity plus delivery", () => {
    expect(goodsTotal(10000, 3, 1500)).toBe(31500);
  });
});

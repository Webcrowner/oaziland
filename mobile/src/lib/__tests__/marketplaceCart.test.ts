import type { CartGroup } from "../api";
import {
  cartBadge, cartLineKey, checkoutBlocker, chosenDeliveryMethod, deliveryOptionLabel, needsDeliveryAddress, quoteRequest,
} from "../marketplaceCart";

const group: CartGroup = {
  seller_id: "s1", seller_name: "Shop", subtotal_xaf: "9000", can_checkout: true,
  delivery_options: [{ method: "PICKUP", fee_xaf: "0" }, { method: "COURIER", fee_xaf: "2500" }],
  items: [],
};

describe("delivery", () => {
  it("labels options with their fee", () => {
    expect(deliveryOptionLabel({ method: "PICKUP", fee_xaf: "0" })).toMatch(/free$/);
    expect(deliveryOptionLabel({ method: "COURIER", fee_xaf: "2500" })).toMatch(/\+2,?500 XAF$/);
  });

  it("asks for an address unless it is a pickup", () => {
    expect(needsDeliveryAddress("PICKUP")).toBe(false);
    expect(needsDeliveryAddress("SELLER")).toBe(true);
    expect(needsDeliveryAddress("")).toBe(false);
  });

  it("picks the only option automatically and ignores an option that is gone", () => {
    expect(chosenDeliveryMethod([{ method: "SELLER", fee_xaf: "0" }], "")).toBe("SELLER");
    expect(chosenDeliveryMethod(group.delivery_options, "COURIER")).toBe("COURIER");
    expect(chosenDeliveryMethod(group.delivery_options, "SELLER")).toBe("");
  });
});

describe("quoteRequest", () => {
  it("sends the address only for delivery and the coupon only when typed", () => {
    expect(quoteRequest("s1", "PICKUP", "Rue 12 Bonanjo", "")).toEqual({ seller_id: "s1", delivery_method: "PICKUP" });
    expect(quoteRequest("s1", "COURIER", " Rue 12 Bonanjo ", "SAVE10")).toEqual({
      seller_id: "s1", delivery_method: "COURIER", delivery_address: "Rue 12 Bonanjo", coupon_code: "SAVE10",
    });
  });
});

describe("checkoutBlocker", () => {
  it("walks through what is still missing", () => {
    expect(checkoutBlocker({ ...group, can_checkout: false }, "PICKUP", "", "670", true)).toMatch(/unavailable/);
    expect(checkoutBlocker(group, "", "", "670", true)).toMatch(/Choose how/);
    expect(checkoutBlocker(group, "COURIER", "Rue", "670", true)).toMatch(/delivery address/);
    expect(checkoutBlocker(group, "PICKUP", "", "670", false)).toMatch(/total/);
    expect(checkoutBlocker(group, "PICKUP", "", " ", true)).toMatch(/phone/);
    expect(checkoutBlocker(group, "PICKUP", "", "670000000", true)).toBe("");
  });
});

describe("cartLineKey", () => {
  it("tells apart versions of the same listing", () => {
    expect(cartLineKey({ listing_id: "l1", variant_id: "v1" })).not.toBe(cartLineKey({ listing_id: "l1", variant_id: "v2" }));
    expect(cartLineKey({ listing_id: "l1", variant_id: null })).toBe("l1:");
  });
});

describe("cartBadge", () => {
  it("hides an empty cart and caps big ones", () => {
    expect(cartBadge(0)).toBe("");
    expect(cartBadge(7)).toBe("7");
    expect(cartBadge(150)).toBe("99+");
  });
});

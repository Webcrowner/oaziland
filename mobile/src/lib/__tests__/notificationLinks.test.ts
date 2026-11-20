import { notificationRoute } from "../notificationLinks";

describe("notificationRoute", () => {
  it("opens an order on the buying or selling tab", () => {
    expect(notificationRoute({ kind: "marketplace_order", id: "o1", role: "selling" })).toEqual({
      name: "MarketplaceOrders", params: { role: "selling", orderId: "o1" },
    });
    expect(notificationRoute({ kind: "marketplace_order", id: "o1", role: "other" })).toEqual({
      name: "MarketplaceOrders", params: { role: undefined, orderId: "o1" },
    });
  });

  it("opens offers on the right tab", () => {
    expect(notificationRoute({ kind: "marketplace_offer", id: "f1", role: "buying" })).toEqual({
      name: "MarketplaceOffers", params: { role: "buying" },
    });
  });

  it("opens a marketplace listing only for a known category", () => {
    expect(notificationRoute({ kind: "marketplace_listing", id: "l1", category: "goods" })).toEqual({
      name: "MarketplaceListingDetail", params: { category: "goods", listingId: "l1" },
    });
    expect(notificationRoute({ kind: "marketplace_listing", id: "l1", category: "boats" })).toBeNull();
  });

  it("opens property listings, jobs and rides", () => {
    expect(notificationRoute({ kind: "listing", id: 7 })).toEqual({ name: "ListingDetail", params: { listingId: "7" } });
    expect(notificationRoute({ kind: "job", id: "j1" })).toEqual({ name: "Careers", params: { jobId: "j1" } });
    expect(notificationRoute({ kind: "ride", id: "r1" })).toEqual({ name: "OaziGo", params: undefined });
  });

  it("has nowhere to go without a usable target", () => {
    expect(notificationRoute(null)).toBeNull();
    expect(notificationRoute(undefined)).toBeNull();
    expect(notificationRoute({ kind: "marketplace_order" })).toBeNull();
    expect(notificationRoute({ kind: "listing" })).toBeNull();
    expect(notificationRoute({ kind: "something_new", id: "x" })).toBeNull();
  });
});

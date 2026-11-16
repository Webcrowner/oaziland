import { describe, expect, it } from "vitest";
import { notificationHref, roleFromParam } from "./notificationLinks";

describe("notificationHref", () => {
  it("returns null without a target", () => {
    expect(notificationHref(null)).toBeNull();
    expect(notificationHref(undefined)).toBeNull();
  });

  it("opens the orders page on the right tab and order", () => {
    expect(notificationHref({ kind: "marketplace_order", id: "o1", role: "selling" })).toBe("/marketplace/orders?role=selling&order=o1");
  });

  it("opens the offers page on the right tab", () => {
    expect(notificationHref({ kind: "marketplace_offer", id: "f1", role: "buying" })).toBe("/marketplace/offers?role=buying&offer=f1");
  });

  it("ignores an unknown role", () => {
    expect(notificationHref({ kind: "marketplace_order", id: "o1", role: "admin" })).toBe("/marketplace/orders?order=o1");
  });

  it("links listings, property listings and rides", () => {
    expect(notificationHref({ kind: "marketplace_listing", id: "7", category: "goods" })).toBe("/marketplace/goods/7");
    expect(notificationHref({ kind: "marketplace_listing", id: "7" })).toBeNull();
    expect(notificationHref({ kind: "listing", id: "abc" })).toBe("/listing/abc");
    expect(notificationHref({ kind: "ride", id: "r1" })).toBe("/oazigo/trips");
  });

  it("does not link unknown kinds", () => {
    expect(notificationHref({ kind: "something_new", id: "1" })).toBeNull();
  });
});

describe("roleFromParam", () => {
  it("accepts only the two roles", () => {
    expect(roleFromParam("buying")).toBe("buying");
    expect(roleFromParam("selling")).toBe("selling");
    expect(roleFromParam("x")).toBeNull();
    expect(roleFromParam(null)).toBeNull();
  });
});

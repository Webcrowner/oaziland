import { EMPTY_SHOP_DRAFT, followerLabel, policyText, POLICY_FALLBACKS, shopDraftError, shopPayload, vacationNotice } from "../marketplaceShop";

describe("shopDraftError", () => {
  it("enforces the length limits and the return date format", () => {
    expect(shopDraftError(EMPTY_SHOP_DRAFT)).toBe("");
    expect(shopDraftError({ ...EMPTY_SHOP_DRAFT, name: "x".repeat(81) })).toMatch(/shop name/);
    expect(shopDraftError({ ...EMPTY_SHOP_DRAFT, announcement: "x".repeat(201) })).toMatch(/announcement/);
    expect(shopDraftError({ ...EMPTY_SHOP_DRAFT, vacationUntil: "soon" })).toMatch(/YYYY-MM-DD/);
    expect(shopDraftError({ ...EMPTY_SHOP_DRAFT, vacationUntil: "2030-02-31" })).toMatch(/YYYY-MM-DD/);
  });
});

describe("shopPayload", () => {
  it("sends a blank return date as null", () => {
    expect(shopPayload({ ...EMPTY_SHOP_DRAFT, name: " Shop ", onVacation: true }))
      .toMatchObject({ name: "Shop", on_vacation: true, vacation_until: null });
    expect(shopPayload({ ...EMPTY_SHOP_DRAFT, vacationUntil: "2030-02-10" })).toMatchObject({ vacation_until: "2030-02-10" });
  });
});

describe("storefront text", () => {
  it("falls back when a policy is empty", () => {
    expect(policyText("  ", "shipping")).toBe(POLICY_FALLBACKS.shipping);
    expect(policyText(" Free over 50k ", "returns")).toBe("Free over 50k");
  });

  it("builds the vacation notice", () => {
    expect(vacationNotice({ vacation_message: "", vacation_until: null }).body).toMatch(/not taking orders/);
    expect(vacationNotice({ vacation_message: "Back soon", vacation_until: "2030-02-10" }).body).toMatch(/^Back soon Back on /);
  });

  it("pluralises followers", () => {
    expect(followerLabel(1)).toBe("1 follower");
    expect(followerLabel(0)).toBe("0 followers");
  });
});

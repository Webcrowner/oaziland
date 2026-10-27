import {
  conditionsAreEmpty, conditionsChanged, conditionsError, conditionsFromItem, conditionsPayload, EMPTY_CONDITIONS,
} from "../marketplaceConditions";
import { depositFor } from "../marketplacePricing";

describe("conditions payload", () => {
  it("sends only ticked flags and filled numbers", () => {
    expect(conditionsPayload("warehouses", { ...EMPTY_CONDITIONS, minLeaseMonths: "12", flags: { deposit_required: true, no_subletting: false }, clause: "  No pets  " })).toEqual({
      structured_conditions: { deposit_required: true, min_lease_months: 12 },
      free_text_clause: "No pets",
    });
  });

  it("ignores conditions that do not apply to the category", () => {
    const draft = { ...EMPTY_CONDITIONS, minLeaseMonths: "6", mileageCapKm: "90000", flags: { driver_required: true, no_subletting: true } };
    expect(conditionsPayload("cars", draft).structured_conditions).toEqual({ driver_required: true, mileage_cap_km: 90000 });
    expect(conditionsPayload("businesses", draft).structured_conditions).toEqual({});
  });

  it("round-trips a stored condition and treats nothing stored as empty", () => {
    const stored = { structured_conditions: { min_lease_months: 24, insurance_required: true, pet_policy: "NO_PETS" }, free_text_clause: "Hi" };
    const draft = conditionsFromItem(stored);
    expect(draft).toEqual({ minLeaseMonths: "24", mileageCapKm: "", flags: { insurance_required: true }, clause: "Hi" });
    expect(conditionsChanged("warehouses", draft, draft)).toBe(false);
    expect(conditionsFromItem(undefined)).toBe(EMPTY_CONDITIONS);
    expect(conditionsAreEmpty("stores", EMPTY_CONDITIONS)).toBe(true);
    expect(conditionsAreEmpty("stores", { ...EMPTY_CONDITIONS, clause: "  " })).toBe(true);
    expect(conditionsAreEmpty("stores", draft)).toBe(false);
  });

  it("detects a change and rejects values the server would reject", () => {
    expect(conditionsChanged("cars", EMPTY_CONDITIONS, { ...EMPTY_CONDITIONS, flags: { driver_required: true } })).toBe(true);
    expect(conditionsError("warehouses", { ...EMPTY_CONDITIONS, minLeaseMonths: "0" })).toMatch(/between 1 and 120/);
    expect(conditionsError("warehouses", { ...EMPTY_CONDITIONS, minLeaseMonths: "121" })).toMatch(/between 1 and 120/);
    expect(conditionsError("cars", { ...EMPTY_CONDITIONS, mileageCapKm: "1000001" })).toMatch(/1,000,000/);
    expect(conditionsError("cars", { ...EMPTY_CONDITIONS, mileageCapKm: "250000" })).toBe("");
  });
});

describe("deposit", () => {
  it("is cleared for a sale and defaults to zero for a rental", () => {
    expect(depositFor("SALE", "50000")).toBe("0");
    expect(depositFor("RENT_MONTHLY", " 50000 ")).toBe("50000");
    expect(depositFor("RENT_WEEKLY", "")).toBe("0");
  });
});

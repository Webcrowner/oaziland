export type MarketplaceCategoryKey = "warehouses" | "stores" | "businesses" | "cars";

export const CONDITION_TARGETS: Record<MarketplaceCategoryKey, string> = {
  warehouses: "marketplace.WarehouseListing",
  stores: "marketplace.StoreListing",
  businesses: "marketplace.BusinessListing",
  cars: "marketplace.CarListing",
};

export const MAX_CLAUSE_LENGTH = 2000;

export type ConditionFlag = "deposit_required" | "insurance_required" | "driver_required" | "no_subletting" | "viewing_appointment_only";

export const FLAG_LABELS: Record<ConditionFlag, string> = {
  deposit_required: "Security deposit required",
  insurance_required: "Insurance required",
  driver_required: "Driver required",
  no_subletting: "No subletting",
  viewing_appointment_only: "Viewing by appointment only",
};

export const FLAGS_BY_CATEGORY: Record<MarketplaceCategoryKey, ConditionFlag[]> = {
  warehouses: ["deposit_required", "insurance_required", "no_subletting", "viewing_appointment_only"],
  stores: ["deposit_required", "insurance_required", "no_subletting", "viewing_appointment_only"],
  businesses: ["deposit_required", "viewing_appointment_only"],
  cars: ["deposit_required", "insurance_required", "driver_required", "viewing_appointment_only"],
};

export interface ConditionsDraft {
  minLeaseMonths: string;
  mileageCapKm: string;
  flags: Partial<Record<ConditionFlag, boolean>>;
  clause: string;
}

export const EMPTY_CONDITIONS: ConditionsDraft = { minLeaseMonths: "", mileageCapKm: "", flags: {}, clause: "" };

export const hasLeaseTerm = (category: MarketplaceCategoryKey) => category === "warehouses" || category === "stores";

const digitsOnly = (value: string) => value.replace(/\D/g, "");

/** The API payload for a draft: only ticked flags and filled numbers, so unticking a box removes the condition. */
export function conditionsPayload(category: MarketplaceCategoryKey, draft: ConditionsDraft) {
  const structured: Record<string, unknown> = {};
  for (const key of FLAGS_BY_CATEGORY[category]) if (draft.flags[key]) structured[key] = true;
  const lease = digitsOnly(draft.minLeaseMonths);
  const mileage = digitsOnly(draft.mileageCapKm);
  if (hasLeaseTerm(category) && lease) structured.min_lease_months = Number(lease);
  if (category === "cars" && mileage) structured.mileage_cap_km = Number(mileage);
  return { structured_conditions: structured, free_text_clause: draft.clause.trim() };
}

export function conditionsFromItem(item: { structured_conditions: Record<string, unknown>; free_text_clause: string } | undefined): ConditionsDraft {
  if (!item) return EMPTY_CONDITIONS;
  const structured = item.structured_conditions;
  const flags: ConditionsDraft["flags"] = {};
  for (const key of Object.keys(FLAG_LABELS) as ConditionFlag[]) {
    if (structured[key] === true) flags[key] = true;
  }
  return {
    minLeaseMonths: typeof structured.min_lease_months === "number" ? String(structured.min_lease_months) : "",
    mileageCapKm: typeof structured.mileage_cap_km === "number" ? String(structured.mileage_cap_km) : "",
    flags,
    clause: item.free_text_clause,
  };
}

export function conditionsAreEmpty(category: MarketplaceCategoryKey, draft: ConditionsDraft) {
  const { structured_conditions, free_text_clause } = conditionsPayload(category, draft);
  return Object.keys(structured_conditions).length === 0 && !free_text_clause;
}

export const conditionsChanged = (category: MarketplaceCategoryKey, before: ConditionsDraft, after: ConditionsDraft) =>
  JSON.stringify(conditionsPayload(category, before)) !== JSON.stringify(conditionsPayload(category, after));

/** Lease months must be 1-120 and mileage 0-1,000,000, matching the server, so a bad value is caught before the listing is posted. */
export function conditionsError(category: MarketplaceCategoryKey, draft: ConditionsDraft): string {
  const lease = digitsOnly(draft.minLeaseMonths);
  if (hasLeaseTerm(category) && lease && (Number(lease) < 1 || Number(lease) > 120)) return "Minimum lease must be between 1 and 120 months.";
  const mileage = digitsOnly(draft.mileageCapKm);
  if (category === "cars" && mileage && Number(mileage) > 1_000_000) return "Mileage cap cannot be more than 1,000,000 km.";
  return "";
}

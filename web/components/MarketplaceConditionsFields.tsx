"use client";
import { useTranslations } from "next-intl";
import {
  attachListingCondition, getListingConditions, MARKETPLACE_CONDITION_TARGETS as CONDITION_TARGETS,
  type ListingConditionItem, type MarketplaceCategory,
} from "@/lib/api";

type BooleanKey = "deposit_required" | "insurance_required" | "driver_required" | "no_subletting" | "viewing_appointment_only";

export interface ConditionsDraft {
  minLeaseMonths: string;
  mileageCapKm: string;
  flags: Partial<Record<BooleanKey, boolean>>;
  clause: string;
}

export const EMPTY_CONDITIONS: ConditionsDraft = { minLeaseMonths: "", mileageCapKm: "", flags: {}, clause: "" };

const FLAGS_BY_CATEGORY: Record<MarketplaceCategory, BooleanKey[]> = {
  warehouses: ["deposit_required", "insurance_required", "no_subletting", "viewing_appointment_only"],
  stores: ["deposit_required", "insurance_required", "no_subletting", "viewing_appointment_only"],
  businesses: ["deposit_required", "viewing_appointment_only"],
  cars: ["deposit_required", "insurance_required", "driver_required", "viewing_appointment_only"],
  goods: [],
};

const hasLeaseTerm = (category: MarketplaceCategory) => category === "warehouses" || category === "stores";

/** The API payload for a draft: only ticked flags and filled numbers, so unticking a box removes the condition. */
export function conditionsPayload(category: MarketplaceCategory, draft: ConditionsDraft) {
  const structured: Record<string, unknown> = {};
  for (const key of FLAGS_BY_CATEGORY[category]) if (draft.flags[key]) structured[key] = true;
  if (hasLeaseTerm(category) && draft.minLeaseMonths) structured.min_lease_months = Number(draft.minLeaseMonths);
  if (category === "cars" && draft.mileageCapKm) structured.mileage_cap_km = Number(draft.mileageCapKm);
  return { structured_conditions: structured, free_text_clause: draft.clause.trim() };
}

export function conditionsFromItem(item: ListingConditionItem | undefined): ConditionsDraft {
  if (!item) return EMPTY_CONDITIONS;
  const structured = item.structured_conditions;
  const flags: ConditionsDraft["flags"] = {};
  for (const key of ["deposit_required", "insurance_required", "driver_required", "no_subletting", "viewing_appointment_only"] as BooleanKey[]) {
    if (structured[key] === true) flags[key] = true;
  }
  return {
    minLeaseMonths: typeof structured.min_lease_months === "number" ? String(structured.min_lease_months) : "",
    mileageCapKm: typeof structured.mileage_cap_km === "number" ? String(structured.mileage_cap_km) : "",
    flags,
    clause: item.free_text_clause,
  };
}

export async function loadConditionsDraft(category: MarketplaceCategory, listingId: string): Promise<ConditionsDraft> {
  const items = await getListingConditions(CONDITION_TARGETS[category], listingId);
  return conditionsFromItem(items[0]);
}

const isEmpty = (category: MarketplaceCategory, draft: ConditionsDraft) => {
  const { structured_conditions, free_text_clause } = conditionsPayload(category, draft);
  return Object.keys(structured_conditions).length === 0 && !free_text_clause;
};

export const conditionsChanged = (category: MarketplaceCategory, before: ConditionsDraft, after: ConditionsDraft) =>
  JSON.stringify(conditionsPayload(category, before)) !== JSON.stringify(conditionsPayload(category, after));

/** Saves a draft for a listing; a brand-new listing with nothing entered needs no request. */
export async function saveConditions(category: MarketplaceCategory, listingId: string, draft: ConditionsDraft, accessToken: string, skipIfEmpty = false) {
  if (skipIfEmpty && isEmpty(category, draft)) return;
  await attachListingCondition({ target_content_type: CONDITION_TARGETS[category], target_id: listingId, ...conditionsPayload(category, draft) }, accessToken);
}

const FLAG_LABELS: Record<BooleanKey, string> = {
  deposit_required: "deposit",
  insurance_required: "insurance",
  driver_required: "driver",
  no_subletting: "noSubletting",
  viewing_appointment_only: "viewingOnly",
};

/** Optional terms a buyer or renter sees before paying: lease length, deposit, insurance and a free-text clause. */
export default function MarketplaceConditionsFields({
  category, value, onChange, className = "",
}: {
  category: MarketplaceCategory;
  value: ConditionsDraft;
  onChange: (next: ConditionsDraft) => void;
  className?: string;
}) {
  const t = useTranslations("MarketplaceConditions");
  const field = "border rounded-lg px-3 py-2 text-sm";

  return (
    <fieldset className={`border border-gray-200 rounded-lg p-4 flex flex-col gap-3 ${className}`}>
      <legend className="px-1 text-sm font-semibold text-gray-700">{t("title")}</legend>
      <p className="text-xs text-gray-500">{t("hint")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {hasLeaseTerm(category) && (
          <input type="number" min="1" max="120" step="1" value={value.minLeaseMonths} onChange={(e) => onChange({ ...value, minLeaseMonths: e.target.value })} placeholder={t("minLease")} aria-label={t("minLease")} className={field} />
        )}
        {category === "cars" && (
          <input type="number" min="0" max="1000000" step="1" value={value.mileageCapKm} onChange={(e) => onChange({ ...value, mileageCapKm: e.target.value })} placeholder={t("mileageCap")} aria-label={t("mileageCap")} className={field} />
        )}
        {FLAGS_BY_CATEGORY[category].map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={Boolean(value.flags[key])} onChange={(e) => onChange({ ...value, flags: { ...value.flags, [key]: e.target.checked } })} />
            {t(FLAG_LABELS[key])}
          </label>
        ))}
      </div>
      <textarea rows={2} maxLength={2000} value={value.clause} onChange={(e) => onChange({ ...value, clause: e.target.value })} placeholder={t("clause")} aria-label={t("clause")} className={field} />
    </fieldset>
  );
}

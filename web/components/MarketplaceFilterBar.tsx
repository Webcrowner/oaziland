"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { GOODS_CATEGORIES, GOODS_CONDITIONS, type Quarter } from "@/lib/api";

export const MARKETPLACE_SORTS = ["newest", "price_asc", "price_desc", "oldest"] as const;
export const MARKETPLACE_PRICE_BASES = ["SALE", "RENT_MONTHLY", "RENT_WEEKLY", "RENT_NIGHTLY", "RENT_ANNUAL"] as const;

export interface MarketplaceFilters {
  q: string;
  ordering: string;
  priceBasis: string;
  minPrice: string;
  maxPrice: string;
  quarterId: string;
  minSizeSqm: string;
  itemCategory: string;
  condition: string;
}

export const EMPTY_MARKETPLACE_FILTERS: MarketplaceFilters = {
  q: "", ordering: "newest", priceBasis: "", minPrice: "", maxPrice: "", quarterId: "", minSizeSqm: "", itemCategory: "", condition: "",
};

/** The filters hidden behind the mobile "Filters" button — everything except the search box and sort order. */
const panelFiltersActive = (f: MarketplaceFilters) =>
  Boolean(f.priceBasis || f.minPrice || f.maxPrice || f.quarterId || f.minSizeSqm || f.itemCategory || f.condition);

/** True when anything beyond the default sort order is narrowing the results. */
export function filtersActive(f: MarketplaceFilters): boolean {
  return Boolean(f.q.trim()) || panelFiltersActive(f);
}

/** Turns the filter state into the query params the marketplace API understands, dropping blanks. */
export function filtersToQuery(f: MarketplaceFilters): Record<string, string> {
  const query: Record<string, string> = { ordering: f.ordering };
  if (f.q.trim()) query.q = f.q.trim();
  if (f.priceBasis) query.price_basis = f.priceBasis;
  if (f.minPrice) query.min_price = f.minPrice;
  if (f.maxPrice) query.max_price = f.maxPrice;
  if (f.quarterId) query.quarter_id = f.quarterId;
  if (f.minSizeSqm) query.min_size_sqm = f.minSizeSqm;
  if (f.itemCategory) query.item_category = f.itemCategory;
  if (f.condition) query.condition = f.condition;
  return query;
}

/**
 * Search box and sort order are always visible; the remaining filters sit in a panel that is collapsed on
 * phones (behind a "Filters" button with an active-count badge) and always open from the md breakpoint up.
 */
export default function MarketplaceFilterBar({
  value, onChange, showPriceBasis = true, showMinSize = false, showGoodsFilters = false, quarters = [],
}: {
  value: MarketplaceFilters;
  onChange: (next: MarketplaceFilters) => void;
  showPriceBasis?: boolean;
  showMinSize?: boolean;
  showGoodsFilters?: boolean;
  quarters?: Quarter[];
}) {
  const t = useTranslations("MarketplaceFilters");
  const tg = useTranslations("MarketplaceGoods");
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<MarketplaceFilters>) => onChange({ ...value, ...patch });
  const field = "w-full min-w-0 border border-slate-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:border-[var(--gold)] focus:outline-none";
  const activeCount = [value.priceBasis, value.minPrice, value.maxPrice, value.quarterId, value.minSizeSqm, value.itemCategory, value.condition].filter(Boolean).length;

  return (
    <div className="mb-5" role="search">
      <div className="flex gap-2">
        <input
          type="search" value={value.q} onChange={(e) => set({ q: e.target.value })}
          placeholder={t("search")} aria-label={t("search")} className={`${field} flex-1`}
        />
        <button
          type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className="md:hidden shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700"
        >
          {t("filters")}
          {activeCount > 0 && <span className="rounded-full bg-[var(--gold)] px-1.5 text-xs text-[var(--navy)]">{activeCount}</span>}
        </button>
      </div>

      <div className={`${open ? "grid" : "hidden"} md:grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-2.5`}>
        {showGoodsFilters && (
          <>
            <select value={value.itemCategory} onChange={(e) => set({ itemCategory: e.target.value })} aria-label={t("itemCategory")} className={field}>
              <option value="">{t("anyItemCategory")}</option>
              {GOODS_CATEGORIES.map((c) => <option key={c} value={c}>{tg(`cat_${c}`)}</option>)}
            </select>
            <select value={value.condition} onChange={(e) => set({ condition: e.target.value })} aria-label={t("condition")} className={field}>
              <option value="">{t("anyCondition")}</option>
              {GOODS_CONDITIONS.map((c) => <option key={c} value={c}>{tg(`cond_${c}`)}</option>)}
            </select>
          </>
        )}
        {showPriceBasis && (
          <select value={value.priceBasis} onChange={(e) => set({ priceBasis: e.target.value })} aria-label={t("priceBasis")} className={field}>
            <option value="">{t("anyPriceBasis")}</option>
            {MARKETPLACE_PRICE_BASES.map((b) => <option key={b} value={b}>{t(`basis_${b}`)}</option>)}
          </select>
        )}
        <input type="number" inputMode="numeric" min="0" value={value.minPrice} onChange={(e) => set({ minPrice: e.target.value })} placeholder={t("minPrice")} aria-label={t("minPrice")} className={field} />
        <input type="number" inputMode="numeric" min="0" value={value.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} placeholder={t("maxPrice")} aria-label={t("maxPrice")} className={field} />
        <select value={value.quarterId} onChange={(e) => set({ quarterId: e.target.value })} aria-label={t("neighborhood")} className={field}>
          <option value="">{t("anyNeighborhood")}</option>
          {quarters.map((quarter) => <option key={quarter.id} value={quarter.id}>{quarter.name}</option>)}
        </select>
        {showMinSize && (
          <input type="number" inputMode="numeric" min="0" value={value.minSizeSqm} onChange={(e) => set({ minSizeSqm: e.target.value })} placeholder={t("minSize")} aria-label={t("minSize")} className={field} />
        )}
        <select value={value.ordering} onChange={(e) => set({ ordering: e.target.value })} aria-label={t("sortBy")} className={field}>
          {MARKETPLACE_SORTS.map((s) => <option key={s} value={s}>{t(`sort_${s}`)}</option>)}
        </select>
        {panelFiltersActive(value) && (
          <button
            type="button" onClick={() => onChange({ ...EMPTY_MARKETPLACE_FILTERS, q: value.q, ordering: value.ordering })}
            className="col-span-2 md:col-span-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-[var(--navy)] underline"
          >
            {t("clearFilters")}
          </button>
        )}
      </div>
    </div>
  );
}

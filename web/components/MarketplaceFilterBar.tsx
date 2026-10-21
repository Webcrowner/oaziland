"use client";
import { useTranslations } from "next-intl";

export const MARKETPLACE_SORTS = ["newest", "price_asc", "price_desc", "oldest"] as const;
export const MARKETPLACE_PRICE_BASES = ["SALE", "RENT_MONTHLY", "RENT_WEEKLY", "RENT_NIGHTLY", "RENT_ANNUAL"] as const;

export interface MarketplaceFilters {
  q: string;
  ordering: string;
  priceBasis: string;
  minPrice: string;
  maxPrice: string;
}

export const EMPTY_MARKETPLACE_FILTERS: MarketplaceFilters = { q: "", ordering: "newest", priceBasis: "", minPrice: "", maxPrice: "" };

/** True when anything beyond the default sort order is narrowing the results. */
export function filtersActive(f: MarketplaceFilters): boolean {
  return Boolean(f.q.trim() || f.priceBasis || f.minPrice || f.maxPrice);
}

/** Turns the filter state into the query params the marketplace API understands, dropping blanks. */
export function filtersToQuery(f: MarketplaceFilters): Record<string, string> {
  const query: Record<string, string> = { ordering: f.ordering };
  if (f.q.trim()) query.q = f.q.trim();
  if (f.priceBasis) query.price_basis = f.priceBasis;
  if (f.minPrice) query.min_price = f.minPrice;
  if (f.maxPrice) query.max_price = f.maxPrice;
  return query;
}

export default function MarketplaceFilterBar({
  value, onChange, showPriceBasis = true,
}: {
  value: MarketplaceFilters;
  onChange: (next: MarketplaceFilters) => void;
  showPriceBasis?: boolean;
}) {
  const t = useTranslations("MarketplaceFilters");
  const set = (patch: Partial<MarketplaceFilters>) => onChange({ ...value, ...patch });
  const bases = MARKETPLACE_PRICE_BASES;
  const field = "border rounded-lg px-3 py-2 text-sm bg-white";

  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6" role="search">
      <input
        type="search" value={value.q} onChange={(e) => set({ q: e.target.value })}
        placeholder={t("search")} aria-label={t("search")} className={`${field} col-span-2`}
      />
      {showPriceBasis && (
        <select value={value.priceBasis} onChange={(e) => set({ priceBasis: e.target.value })} aria-label={t("priceBasis")} className={field}>
          <option value="">{t("anyPriceBasis")}</option>
          {bases.map((b) => <option key={b} value={b}>{t(`basis_${b}`)}</option>)}
        </select>
      )}
      <input type="number" min="0" value={value.minPrice} onChange={(e) => set({ minPrice: e.target.value })} placeholder={t("minPrice")} aria-label={t("minPrice")} className={field} />
      <input type="number" min="0" value={value.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} placeholder={t("maxPrice")} aria-label={t("maxPrice")} className={field} />
      <select value={value.ordering} onChange={(e) => set({ ordering: e.target.value })} aria-label={t("sortBy")} className={field}>
        {MARKETPLACE_SORTS.map((s) => <option key={s} value={s}>{t(`sort_${s}`)}</option>)}
      </select>
    </div>
  );
}

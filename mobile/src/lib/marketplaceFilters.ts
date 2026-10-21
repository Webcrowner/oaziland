export interface MarketplaceFilters {
  q: string;
  ordering: string;
  priceBasis: string;
  minPrice: string;
  maxPrice: string;
}

export const EMPTY_MARKETPLACE_FILTERS: MarketplaceFilters = { q: "", ordering: "newest", priceBasis: "", minPrice: "", maxPrice: "" };

export const MARKETPLACE_SORTS: { value: string; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price ↑" },
  { value: "price_desc", label: "Price ↓" },
  { value: "oldest", label: "Oldest" },
];

export const MARKETPLACE_PRICE_BASES: { value: string; label: string }[] = [
  { value: "", label: "Any" },
  { value: "SALE", label: "For sale" },
  { value: "RENT_MONTHLY", label: "Rent / month" },
  { value: "RENT_WEEKLY", label: "Rent / week" },
  { value: "RENT_NIGHTLY", label: "Rent / night" },
  { value: "RENT_ANNUAL", label: "Rent / year" },
];

/** Turns the filter state into the query params the marketplace API understands, dropping blanks. */
export function filtersToQuery(f: MarketplaceFilters): Record<string, string> {
  const query: Record<string, string> = { ordering: f.ordering };
  if (f.q.trim()) query.q = f.q.trim();
  if (f.priceBasis) query.price_basis = f.priceBasis;
  if (f.minPrice.trim()) query.min_price = f.minPrice.trim();
  if (f.maxPrice.trim()) query.max_price = f.maxPrice.trim();
  return query;
}

/** True when anything beyond the default sort order is narrowing the results. */
export function filtersActive(f: MarketplaceFilters): boolean {
  return Boolean(f.q.trim() || f.priceBasis || f.minPrice.trim() || f.maxPrice.trim());
}

export const PRICE_BASIS_LABELS: Record<string, string> = {
  SALE: "For sale", RENT_NIGHTLY: "Rent / night", RENT_WEEKLY: "Rent / week", RENT_MONTHLY: "Rent / month", RENT_ANNUAL: "Rent / year", PER_TRIP: "Per trip",
};

import type { MarketplaceCategory, PaginatedResponse } from "./api";

export const SEARCH_CATEGORIES: MarketplaceCategory[] = ["warehouses", "stores", "businesses", "cars"];
export const MIN_SEARCH_LENGTH = 2;

export interface MarketplaceSearchResult {
  id: string;
  title: string;
  price_xaf: string;
  price_basis: string;
  quarter_name: string | null;
  category: MarketplaceCategory;
}

export type ListCategory = (category: MarketplaceCategory, filters: Record<string, string>) => Promise<PaginatedResponse<Omit<MarketplaceSearchResult, "category">>>;

export interface MarketplaceSearchOutcome {
  results: MarketplaceSearchResult[];
  // True when some categories answered and others failed, so the shown results are incomplete.
  partial: boolean;
  // True when every category failed.
  failed: boolean;
}

/** Only searches once there are enough characters to be meaningful; returns the trimmed query or "". */
export function searchableQuery(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : "";
}

/** Searches all four categories at once; one category failing still shows the others. */
export async function searchMarketplace(query: string, list: ListCategory): Promise<MarketplaceSearchOutcome> {
  const responses = await Promise.allSettled(
    SEARCH_CATEGORIES.map((category) =>
      list(category, { q: query, ordering: "newest" }).then((data) => data.results.map((listing) => ({ ...listing, category }))),
    ),
  );
  const fulfilled = responses.filter((r): r is PromiseFulfilledResult<MarketplaceSearchResult[]> => r.status === "fulfilled");
  if (fulfilled.length === 0) return { results: [], partial: false, failed: true };
  return { results: fulfilled.flatMap((r) => r.value), partial: fulfilled.length !== responses.length, failed: false };
}

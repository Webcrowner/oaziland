"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import PropertyCard from "@/components/PropertyCard";
import EmptyState from "@/components/ui/EmptyState";
import { searchListings, type Listing, type Quarter } from "@/lib/api";

// Leaflet touches `window` directly — SSR must be disabled, the same
// requirement already established for PropertyMap on the listing
// detail page.
const SearchResultsMap = dynamic(() => import("@/components/SearchResultsMap"), { ssr: false });

const PROPERTY_TYPES = ["HOUSE", "LAND", "SHOP", "BUILDING"];
const FINISH_LEVELS = ["MODERN", "STANDARD"];

/**
 * The real map+list split view — the single biggest visual gap
 * between the previous search page and what a Zillow/Trulia-style
 * search actually looks like. This is the client-interactive half;
 * the page itself (search/page.tsx) stays a real Server Component
 * that fetches the initial results for SEO, and passes them in here
 * as a prop — search engines still receive fully-rendered listing
 * HTML, exactly as before, with the interactive map layered on top
 * for real visitors.
 */
export default function SearchResultsView({
  listings: initialListings,
  count,
  quarters,
}: {
  listings: Listing[];
  count: number;
  quarters: Quarter[];
}) {
  const t = useTranslations("SearchPage");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [listings, setListings] = useState(initialListings);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // Real result set changed (new filters applied server-side) — reset
  // the client-side "Load More" pagination state to match.
  useEffect(() => {
    setListings(initialListings);
    setPage(1);
  }, [initialListings]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  async function loadMore() {
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const data = await searchListings({
        quarter: searchParams.get("quarter") || undefined,
        property_type: searchParams.get("property_type") || undefined,
        finish_level: searchParams.get("finish_level") || undefined,
        listing_type: searchParams.get("listing_type") || undefined,
        ordering: searchParams.get("ordering") || undefined,
        max_price: searchParams.get("max_price") || undefined,
        page: String(nextPage),
      });
      setListings((prev) => [...prev, ...data.results]);
      setPage(nextPage);
    } catch {
      // Real network/API failure — leave the current results as-is
      // rather than silently pretending more were loaded.
    } finally {
      setLoadingMore(false);
    }
  }

  function scrollToCard(id: string) {
    document.getElementById(`listing-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const currentListingType = searchParams.get("listing_type") || "";
  const currentPropertyType = searchParams.get("property_type") || "";
  const currentFinishLevel = searchParams.get("finish_level") || "";
  const currentQuarter = searchParams.get("quarter") || "";
  const currentOrdering = searchParams.get("ordering") || "";
  const currentMaxPrice = searchParams.get("max_price") || "";
  const hasMore = listings.length < count;

  return (
    <div>
      {/* Real filter chips — a direct, one-tap change, not a buried
          dropdown someone has to open first to see what's even
          available. */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(["", "RENT", "SALE"] as const).map((value) => (
          <button
            key={value || "any"}
            onClick={() => updateFilter("listing_type", value)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
              currentListingType === value ? "bg-[var(--navy)] text-white border-[var(--navy)]" : "border-gray-300 text-gray-700 hover:border-[var(--navy)]"
            }`}
          >
            {value === "" ? t("chipAnyType") : value === "RENT" ? t("chipForRent") : t("chipForSale")}
          </button>
        ))}
        <span className="w-px h-5 bg-gray-300 mx-1" />
        {PROPERTY_TYPES.map((value) => (
          <button
            key={value}
            onClick={() => updateFilter("property_type", currentPropertyType === value ? "" : value)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
              currentPropertyType === value ? "bg-[var(--gold)] text-[var(--navy)] border-[var(--gold)]" : "border-gray-300 text-gray-700 hover:border-[var(--navy)]"
            }`}
          >
            {value}
          </button>
        ))}
        <span className="w-px h-5 bg-gray-300 mx-1" />
        {FINISH_LEVELS.map((value) => (
          <button
            key={value}
            onClick={() => updateFilter("finish_level", currentFinishLevel === value ? "" : value)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
              currentFinishLevel === value ? "bg-slate-800 text-white border-slate-800" : "border-gray-300 text-gray-700 hover:border-[var(--navy)]"
            }`}
          >
            {value === "MODERN" ? t("finishModern") : t("finishStandard")}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select
          value={currentQuarter}
          onChange={(e) => updateFilter("quarter", e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 bg-white"
        >
          <option value="">{t("anyNeighborhood")}</option>
          {quarters.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>

        <select
          value={currentOrdering}
          onChange={(e) => updateFilter("ordering", e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 bg-white"
        >
          <option value="">{t("sortNewest")}</option>
          <option value="price_asc">{t("sortPriceAsc")}</option>
          <option value="price_desc">{t("sortPriceDesc")}</option>
        </select>

        <button onClick={() => setShowMap(!showMap)} className="hidden lg:inline ml-auto text-sm font-semibold text-[var(--navy)] underline">
          {showMap ? t("hideMap") : t("showMap")}
        </button>
      </div>

      {currentMaxPrice && (
        <div className="mb-4">
          <button
            onClick={() => updateFilter("max_price", "")}
            className="px-3 py-1.5 rounded-full text-sm font-semibold border bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100"
            aria-label="Clear budget filter"
          >
            Budget: up to {Number(currentMaxPrice).toLocaleString()} XAF ✕
          </button>
        </div>
      )}

      {listings.length === 0 ? (
        <EmptyState icon="🏠" title={t("noResults")} />
      ) : (
        <div className={showMap ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : ""}>
          <div>
            <div className={`grid grid-cols-1 ${showMap ? "" : "sm:grid-cols-2 lg:grid-cols-3"} gap-6 ${showMap ? "lg:max-h-[75vh] lg:overflow-y-auto lg:pr-2" : ""}`}>
              {listings.map((listing) => (
                <div
                  key={listing.id} id={`listing-card-${listing.id}`}
                  onMouseEnter={() => setHoveredId(listing.id)} onMouseLeave={() => setHoveredId(null)}
                  className={`rounded-lg transition-shadow ${hoveredId === listing.id ? "ring-2 ring-[var(--gold)]" : ""}`}
                >
                  <PropertyCard listing={listing} />
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-6 py-2.5 rounded-full text-sm font-semibold border border-[var(--navy)] text-[var(--navy)] hover:bg-[var(--navy)] hover:text-white transition-colors disabled:opacity-50"
                >
                  {loadingMore ? t("loadingMore") : t("loadMore")}
                </button>
              </div>
            )}
          </div>

          {showMap && (
            <div className="hidden lg:block sticky top-4 h-[75vh] rounded-lg overflow-hidden border border-gray-200">
              <SearchResultsMap listings={listings} hoveredId={hoveredId} onMarkerClick={scrollToCard} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

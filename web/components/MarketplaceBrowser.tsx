"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listQuarters, MARKETPLACE_CATEGORIES, type MarketplaceCategory, type Quarter } from "@/lib/api";
import { useMarketplaceFeed } from "@/lib/useMarketplaceListings";
import MarketplaceFilterBar, { EMPTY_MARKETPLACE_FILTERS, filtersActive, filtersToQuery, type MarketplaceFilters } from "@/components/MarketplaceFilterBar";
import MarketplaceListingCard from "@/components/MarketplaceListingCard";
import LoadMoreButton from "@/components/LoadMoreButton";

export type BrowseCategory = MarketplaceCategory | "all";

const TAB_ICONS: Record<BrowseCategory, string> = { all: "✨", goods: "🛍️", cars: "🚗", stores: "🏬", warehouses: "🏭", businesses: "💼" };

const isBrowseCategory = (value: string | undefined): value is BrowseCategory =>
  value === "all" || (MARKETPLACE_CATEGORIES as readonly string[]).includes(value ?? "");

/** The marketplace index: category tabs, search, filters and a responsive grid of everything for sale or rent. */
export default function MarketplaceBrowser({ initialCategory = "all" }: { initialCategory?: string }) {
  const t = useTranslations("MarketplacePage");
  const [category, setCategory] = useState<BrowseCategory>(isBrowseCategory(initialCategory) ? initialCategory : "all");
  const [filters, setFilters] = useState<MarketplaceFilters>(EMPTY_MARKETPLACE_FILTERS);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const { items, status, hasMore, loadingMore, loadMore, total } = useMarketplaceFeed(category, filtersToQuery(filters));

  useEffect(() => {
    listQuarters().then(setQuarters).catch(() => {});
  }, []);

  function selectCategory(next: BrowseCategory) {
    setCategory(next);
    // Goods-only filters would silently hide everything in other categories, so they reset with the tab.
    setFilters((f) => ({ ...f, itemCategory: "", condition: "", minSizeSqm: next === "stores" || next === "warehouses" || next === "businesses" ? f.minSizeSqm : "" }));
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("category");
    else url.searchParams.set("category", next);
    window.history.replaceState(null, "", url);
  }

  const tabs: BrowseCategory[] = ["all", ...MARKETPLACE_CATEGORIES];
  const sizeRelevant = category === "stores" || category === "warehouses" || category === "businesses";

  return (
    <section aria-label={t("browseTitle")}>
      <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2" role="tablist" aria-label={t("categories")}>
          {tabs.map((tab) => (
            <button
              key={tab} role="tab" type="button" aria-selected={category === tab} onClick={() => selectCategory(tab)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                category === tab ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-slate-300 bg-white text-slate-700 hover:border-[var(--navy)]"
              }`}
            >
              <span aria-hidden>{TAB_ICONS[tab]}</span>{tab === "all" ? t("all") : t(tab)}
            </button>
          ))}
        </div>
      </div>

      <MarketplaceFilterBar
        value={filters} onChange={setFilters} quarters={quarters}
        showGoodsFilters={category === "goods"} showMinSize={sizeRelevant} showPriceBasis={category !== "goods"}
      />

      {status === "loading" ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : status === "error" ? (
        <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{t("loadFailed")}</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="mb-1 text-lg font-semibold text-[var(--navy)]">{filtersActive(filters) ? t("noSearchResults") : t("nothingListed")}</p>
          <p className="mb-5 text-sm text-slate-500">{filtersActive(filters) ? t("tryDifferent") : t("beTheFirst")}</p>
          <Link href="/marketplace/sell" className="inline-flex rounded-xl gold-gradient px-5 py-2.5 text-sm font-bold text-[var(--navy)]">{t("sellAnItem")}</Link>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500" aria-live="polite">{t("resultCount", { count: total })}</p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {items.map((listing) => <MarketplaceListingCard key={`${listing.category}-${listing.id}`} listing={listing} />)}
          </div>
          {hasMore && <LoadMoreButton onClick={loadMore} loading={loadingMore} />}
        </>
      )}
    </section>
  );
}

"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { createSavedSearch, listQuarters, MARKETPLACE_CATEGORIES, type MarketplaceCategory, type Quarter } from "@/lib/api";
import { useMarketplaceFeed } from "@/lib/useMarketplaceListings";
import MarketplaceFilterBar, { CAR_SORTS, EMPTY_CAR_FILTERS, EMPTY_MARKETPLACE_FILTERS, filtersActive, filtersToQuery, queryToFilters, type MarketplaceFilters } from "@/components/MarketplaceFilterBar";
import MarketplaceListingCard from "@/components/MarketplaceListingCard";
import LoadMoreButton from "@/components/LoadMoreButton";

// Leaflet needs `window`, so the map only renders in the browser.
const MarketplaceMap = dynamic(() => import("@/components/MarketplaceMap"), {
  ssr: false,
  loading: () => <div className="h-[28rem] w-full animate-pulse rounded-2xl bg-slate-100" />,
});

export type BrowseCategory = MarketplaceCategory | "all";

const TAB_ICONS: Record<BrowseCategory, string> = { all: "✨", goods: "🛍️", cars: "🚗", stores: "🏬", warehouses: "🏭", businesses: "💼" };

const isBrowseCategory = (value: string | undefined): value is BrowseCategory =>
  value === "all" || (MARKETPLACE_CATEGORIES as readonly string[]).includes(value ?? "");

/** The marketplace index: category tabs, search, filters and a responsive grid of everything for sale or rent.
 * lockedCategory shows one category only, without the tabs (e.g. cars inside OaziGo). */
export default function MarketplaceBrowser({ initialCategory = "all", lockedCategory }: { initialCategory?: string; lockedCategory?: MarketplaceCategory }) {
  const t = useTranslations("MarketplacePage");
  const locale = useLocale();
  const [category, setCategory] = useState<BrowseCategory>(lockedCategory ?? (isBrowseCategory(initialCategory) ? initialCategory : "all"));
  const [view, setView] = useState<"list" | "map">("list");
  const [filters, setFilters] = useState<MarketplaceFilters>(EMPTY_MARKETPLACE_FILTERS);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const { items, status, hasMore, loadingMore, loadMore, total, retry } = useMarketplaceFeed(category, filtersToQuery(filters));

  const router = useRouter();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    listQuarters().then(setQuarters).catch(() => {});
    // A saved search or a shared link opens with its filters applied.
    const params = new URLSearchParams(window.location.search);
    if ([...params.keys()].some((key) => key !== "category")) {
      void Promise.resolve().then(() => setFilters(queryToFilters(params)));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => setSaveState("idle"));
  }, [filters, category]);

  /** Like Jiji or Leboncoin alerts: get notified when a new listing matches these filters. */
  async function saveSearch() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    const query = filtersToQuery(filters);
    const name = [category === "all" ? t("all") : t(category), filters.q.trim(), filters.make.trim(), filters.model.trim()].filter(Boolean).join(" · ");
    setSaveState("saving");
    try {
      await createSavedSearch(name, { ...query, ...(category !== "all" ? { category } : {}) }, token, "MARKETPLACE");
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  function selectCategory(next: BrowseCategory) {
    setCategory(next);
    // Goods-only and car-only filters would silently hide everything in other categories, so they reset with the tab.
    setFilters((f) => ({
      ...f, ...EMPTY_CAR_FILTERS, itemCategory: "", condition: "",
      // The cars tab has its own sale/rent selector, so its choice of basis doesn't carry over.
      priceBasis: category === "cars" || next === "cars" ? "" : f.priceBasis,
      ordering: (CAR_SORTS as readonly string[]).includes(f.ordering) ? "newest" : f.ordering,
      minSizeSqm: next === "stores" || next === "warehouses" || next === "businesses" ? f.minSizeSqm : "",
    }));
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("category");
    else url.searchParams.set("category", next);
    window.history.replaceState(null, "", url);
  }

  const tabs: BrowseCategory[] = ["all", ...MARKETPLACE_CATEGORIES];
  const sizeRelevant = category === "stores" || category === "warehouses" || category === "businesses";
  const unplotted = items.filter((listing) => listing.latitude == null || listing.longitude == null).length;

  return (
    <section aria-label={t("browseTitle")}>
      {!lockedCategory && (
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
      )}

      <MarketplaceFilterBar
        value={filters} onChange={setFilters} quarters={quarters}
        showGoodsFilters={category === "goods"} showCarFilters={category === "cars"} showMinSize={sizeRelevant} showPriceBasis={category !== "goods" && category !== "cars"}
      />

      {status === "loading" ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{t("loadFailed")}</p>
          <button type="button" onClick={retry} className="font-semibold underline">{t("retry")}</button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="mb-1 text-lg font-semibold text-[var(--navy)]">{filtersActive(filters) ? t("noSearchResults") : t("nothingListed")}</p>
          <p className="mb-5 text-sm text-slate-500">{filtersActive(filters) ? t("tryDifferent") : t("beTheFirst")}</p>
          {filtersActive(filters) && (
            <p className="mb-4">
              {saveState === "saved" ? (
                <Link href="/saved-searches" className="text-sm font-semibold text-green-700 underline">✓ {t("searchSaved")}</Link>
              ) : (
                <button type="button" onClick={saveSearch} disabled={saveState === "saving"} className="text-sm font-semibold text-[var(--navy)] underline disabled:opacity-50">
                  🔔 {saveState === "error" ? t("saveSearchFailed") : t("alertMeNoResults")}
                </button>
              )}
            </p>
          )}
          <Link href={category === "all" || category === "goods" ? "/marketplace/sell" : `/marketplace/sell/${category}`} className="inline-flex rounded-xl gold-gradient px-5 py-2.5 text-sm font-bold text-[var(--navy)]">{t("sellAnItem")}</Link>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-sm text-slate-500" aria-live="polite">{t("resultCount", { count: total })}</p>
              {filtersActive(filters) && (
                saveState === "saved" ? (
                  <Link href="/saved-searches" className="text-sm font-semibold text-green-700 underline">✓ {t("searchSaved")}</Link>
                ) : (
                  <button type="button" onClick={saveSearch} disabled={saveState === "saving"} className="text-sm font-semibold text-[var(--navy)] underline disabled:opacity-50">
                    🔔 {saveState === "error" ? t("saveSearchFailed") : t("saveSearch")}
                  </button>
                )
              )}
            </div>
            <div className="inline-flex overflow-hidden rounded-xl border border-slate-300 text-sm font-semibold" role="group">
              {(["list", "map"] as const).map((mode) => (
                <button
                  key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}
                  className={`px-3.5 py-1.5 ${view === mode ? "bg-[var(--navy)] text-white" : "bg-white text-slate-700"}`}
                >
                  {mode === "list" ? t("viewList") : t("viewMap")}
                </button>
              ))}
            </div>
          </div>
          {view === "map" ? (
            <>
              <MarketplaceMap
                listings={items}
                locale={locale}
                viewer={filters.nearLat ? { latitude: Number(filters.nearLat), longitude: Number(filters.nearLng) } : null}
              />
              {unplotted > 0 && <p className="mt-2 text-xs text-slate-500">{t("mapNotPlotted", { count: unplotted })}</p>}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {items.map((listing) => <MarketplaceListingCard key={`${listing.category}-${listing.id}`} listing={listing} />)}
            </div>
          )}
          {hasMore && <LoadMoreButton onClick={loadMore} loading={loadingMore} />}
        </>
      )}
    </section>
  );
}

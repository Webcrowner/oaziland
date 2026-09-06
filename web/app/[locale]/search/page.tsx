import { getTranslations } from "next-intl/server";
import SearchResultsView from "@/components/SearchResultsView";
import SaveSearchButton from "@/components/SaveSearchButton";
import { searchListings } from "@/lib/api";
import type { Metadata } from "next";

/**
 * WHY this page is set noindex (but follow) rather than given a
 * dynamic per-filter title: search results with query-string filters
 * (quarter, property_type, listing_type, finish_level) can combine
 * into thousands of near-identical parameter permutations — indexing
 * all of them creates a real duplicate/thin-content problem that can
 * hurt the whole site's ranking, a well-documented SEO pitfall for
 * marketplace search pages specifically. 'follow' still passes link
 * equity through to the real content pages this page links to — the
 * individual listing detail pages, which DO have their own real,
 * unique, indexable metadata (see listing/[id]/page.tsx).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

/**
 * Search results — redesigned around the real map+list split every
 * major real estate platform's search page uses. WHY the page itself
 * stays a real, unchanged Server Component fetching data server-side:
 * search engines still receive fully-rendered listing HTML — the
 * actual SEO requirement this page has always had — with the new
 * interactive map layered on top for real visitors via
 * SearchResultsView, a client component that receives these
 * server-fetched results as a prop rather than re-fetching them
 * client-side.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ quarter?: string; property_type?: string; finish_level?: string; listing_type?: string }>;
}) {
  const t = await getTranslations("SearchPage");
  const params = await searchParams;
  const data = await searchListings(params).catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-gray-600">
            {data.count === 1 ? t("countFoundOne", { count: data.count }) : t("countFoundOther", { count: data.count })}
          </p>
          {Object.keys(params).length > 0 && (
            <SaveSearchButton filters={params as Record<string, string>} />
          )}
        </div>

        <SearchResultsView listings={data.results} />
      </div>
    </main>
  );
}

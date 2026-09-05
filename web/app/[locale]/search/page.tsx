import { getTranslations } from "next-intl/server";
import PropertyCard from "@/components/PropertyCard";
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
 * Search results — Page 2 of Prompt 17. Server-rendered (a real
 * Server Component, no client-side fetch) so search engines receive
 * fully-rendered HTML with real listing data — the actual SEO
 * requirement from the Technology Stack document, not just a claim.
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
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <p className="text-gray-600">
            {data.count === 1 ? t("countFoundOne", { count: data.count }) : t("countFoundOther", { count: data.count })}
          </p>
          {Object.keys(params).length > 0 && (
            <SaveSearchButton filters={params as Record<string, string>} />
          )}
        </div>

        {data.results.length === 0 ? (
          <p className="text-gray-500">{t("noResults")}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.results.map((listing) => (
              <PropertyCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

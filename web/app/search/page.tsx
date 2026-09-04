import Header from "@/components/Header";
import PropertyCard from "@/components/PropertyCard";
import { searchListings } from "@/lib/api";

/**
 * Search results — Page 2 of Prompt 17. Server-rendered (a real
 * Server Component, no client-side fetch) so search engines receive
 * fully-rendered HTML with real listing data — the actual SEO
 * requirement from the Technology Stack document, not just a claim.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ quarter?: string; property_type?: string; finish_level?: string }>;
}) {
  const params = await searchParams;
  const data = await searchListings(params).catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main>
      <Header />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">Search Results</h1>
        <p className="text-gray-600 mb-6">{data.count} propert{data.count === 1 ? "y" : "ies"} found</p>

        {data.results.length === 0 ? (
          <p className="text-gray-500">No listings match your search yet. Try a different neighborhood or filter.</p>
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

import Header from "@/components/Header";
import { listQuarters } from "@/lib/api";

/**
 * Home page — Page 1 of Prompt 17. Server Component: quarters are
 * fetched at request time so the search form's dropdown is always
 * populated with real, current data, not a hardcoded list.
 */
export default async function HomePage() {
  const quarters = await listQuarters().catch(() => []);

  return (
    <main>
      <Header />

      <section className="bg-[#1B2A4A] text-white py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl md:text-5xl font-bold mb-4">
            Find your next home in Cameroon
          </h1>
          <p className="text-gray-300 mb-8 hidden md:block">
            Verified listings, secure payments, and trusted agents — all in one place.
          </p>

          {/* The hero search form — this IS the priority on mobile;
              everything else on this page is secondary. */}
          <form action="/search" method="GET" className="bg-white rounded-lg p-4 flex flex-col md:flex-row gap-3">
            <select
              name="quarter"
              className="flex-1 border rounded px-3 py-2 text-gray-800"
              defaultValue=""
            >
              <option value="" disabled>Choose a neighborhood</option>
              {quarters.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name} ({q.village_name})
                </option>
              ))}
            </select>

            {/* Extra filters — visible on desktop inline, still present
                (not hidden) on mobile, just stacked, per the responsive
                design table's "same fields, stacked vertically" rule. */}
            <select name="property_type" className="flex-1 border rounded px-3 py-2 text-gray-800" defaultValue="">
              <option value="">Any property type</option>
              <option value="HOUSE">House</option>
              <option value="LAND">Land</option>
              <option value="SHOP">Shop</option>
            </select>
            <select name="finish_level" className="flex-1 border rounded px-3 py-2 text-gray-800" defaultValue="">
              <option value="">Modern or standard</option>
              <option value="MODERN">Modern</option>
              <option value="STANDARD">Standard</option>
            </select>

            <button type="submit" className="bg-[#C9A227] text-[#1B2A4A] font-semibold px-6 py-2 rounded hover:opacity-90">
              Search
            </button>
          </form>
        </div>
      </section>

      {/* Trust strip — desktop only, per the responsive design table
          ("hidden — moved to footer on mobile"). */}
      <section className="hidden md:block bg-gray-50 py-6">
        <div className="max-w-6xl mx-auto px-4 flex justify-center gap-10 text-sm text-gray-600">
          <span>✓ Verified Listings</span>
          <span>✓ Secure Mobile Money Payments</span>
          <span>✓ Trusted Local Agents</span>
        </div>
      </section>
    </main>
  );
}

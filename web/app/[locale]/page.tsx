import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listQuarters } from "@/lib/api";

/**
 * Home page — Page 1 of Prompt 17. Server Component: quarters are
 * fetched at request time so the search form's dropdown is always
 * populated with real, current data, not a hardcoded list.
 *
 * WHY rent/sale property search stays the clear PRIMARY action on
 * this page, with hotels/hostels/venues/guest-houses as a secondary
 * "explore more" row underneath: per the founder's explicit note,
 * this is a general real estate marketplace first — the newer
 * hospitality categories are real, valuable additions, not a
 * takeover of what the platform fundamentally is.
 */
export default async function HomePage() {
  const t = await getTranslations("HomePage");
  const quarters = await listQuarters().catch(() => []);

  return (
    <main>
      <section className="bg-[#1B2A4A] text-white py-16 px-4 animate-fade-in">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl md:text-5xl font-bold mb-4">{t("heroTitle")}</h1>
          <p className="text-gray-300 mb-8 hidden md:block">{t("heroSubtitle")}</p>

          {/* The hero search form — this IS the priority on mobile;
              everything else on this page is secondary. */}
          <form action="/search" method="GET" className="bg-white rounded-lg p-4 flex flex-col gap-3">
            {/* Rent vs Sale — the platform's two most basic categories,
                given their own explicit toggle rather than buried
                inside a generic dropdown. */}
            <div className="flex rounded overflow-hidden border border-gray-300">
              <label className="flex-1">
                <input type="radio" name="listing_type" value="RENT" defaultChecked className="peer sr-only" />
                <span className="block text-center py-2 text-gray-700 peer-checked:bg-[#1B2A4A] peer-checked:text-white cursor-pointer transition-colors">
                  {t("forRent")}
                </span>
              </label>
              <label className="flex-1">
                <input type="radio" name="listing_type" value="SALE" className="peer sr-only" />
                <span className="block text-center py-2 text-gray-700 peer-checked:bg-[#1B2A4A] peer-checked:text-white cursor-pointer transition-colors">
                  {t("forSale")}
                </span>
              </label>
            </div>

            <div className="flex flex-col md:flex-row gap-3">
              <select name="quarter" className="flex-1 border rounded px-3 py-2 text-gray-800" defaultValue="">
                <option value="" disabled>{t("chooseNeighborhood")}</option>
                {quarters.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name} ({q.village_name})
                  </option>
                ))}
              </select>

              <select name="property_type" className="flex-1 border rounded px-3 py-2 text-gray-800" defaultValue="">
                <option value="">{t("anyPropertyType")}</option>
                <option value="HOUSE">{t("house")}</option>
                <option value="LAND">{t("land")}</option>
                <option value="SHOP">{t("shop")}</option>
              </select>
              <select name="finish_level" className="flex-1 border rounded px-3 py-2 text-gray-800" defaultValue="">
                <option value="">{t("modernOrStandard")}</option>
                <option value="MODERN">{t("modern")}</option>
                <option value="STANDARD">{t("standard")}</option>
              </select>

              <button type="submit" className="bg-[#C9A227] text-[#1B2A4A] font-semibold px-6 py-2 rounded transition-all duration-150 hover:opacity-90 hover:scale-[1.03]">
                {t("search")}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Trust strip — desktop only, per the responsive design table
          ("hidden — moved to footer on mobile"). */}
      <section className="hidden md:block bg-gray-50 py-6">
        <div className="max-w-6xl mx-auto px-4 flex justify-center gap-10 text-sm text-gray-600">
          <span>{t("trustVerifiedListings")}</span>
          <span>{t("trustSecurePayments")}</span>
          <span>{t("trustLocalAgents")}</span>
        </div>
      </section>

      {/* Explore more — secondary, clearly not the main event. Every
          category here is real and bookable, but rent/sale above is
          what a first-time visitor should understand this platform is
          for, before discovering it's ALSO a hotel/venue/hostel/
          guest-house marketplace. */}
      <section className="py-10 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-lg font-semibold text-[#1B2A4A] mb-4">{t("exploreMore")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { href: "/hotels", label: t("categoryHotels") },
              { href: "/student-hostels", label: t("categoryStudentHostels") },
              { href: "/events", label: t("categoryEventVenues") },
              { href: "/guest-houses", label: t("categoryGuestHouses") },
            ].map((category) => (
              <Link
                key={category.href}
                href={category.href}
                className="border rounded-lg p-4 text-center text-sm font-medium text-[#1B2A4A] transition-all duration-150 hover:shadow-md hover:border-[#C9A227]"
              >
                {category.label}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

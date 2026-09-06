import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listQuarters } from "@/lib/api";
import type { Metadata } from "next";

/**
 * WHY the home page needs its own generateMetadata, even though the
 * root layout already has a static one: the root layout's metadata is
 * English-only and identical regardless of locale — a French visitor
 * (or French search results) would see an English title/description
 * for the site's own homepage. This makes the home page's metadata
 * genuinely locale-aware, the same fix applied to every other page in
 * this pass.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr"
      ? "Oaziland — Immobilier, Hôtels et Plus au Cameroun"
      : "Oaziland — Real Estate, Hotels, and More in Cameroon",
    description: locale === "fr"
      ? "Trouvez des propriétés à louer ou à vendre, des hôtels, des résidences étudiantes et des salles d'événements vérifiés à travers le Cameroun."
      : "Find verified properties to rent or buy, hotels, student hostels, and event venues across Cameroon.",
  };
}

/**
 * Home page. Server Component: quarters are fetched at request time
 * so the search form's dropdown is always populated with real,
 * current data, not a hardcoded list.
 *
 * DESIGN NOTES (the visual redesign): the hero's single bold move is
 * a hand-built SVG skyline motif — rooflines and a market-stall silhouette
 * rendered in the brand's own navy/gold/clay palette, drifting gently
 * rather than sitting static — grounding the page in a specific place
 * rather than a generic "real estate app" hero. Everything else stays
 * deliberately quiet: one entrance sequence on load (headline, then
 * subhead, then the search form, staggered), no scattered per-card
 * animation elsewhere. Rent/sale search remains the clear primary
 * action; hospitality categories stay a secondary "explore more" row,
 * per the founder's own explicit instruction that this is a general
 * real estate marketplace first.
 */
export default async function HomePage() {
  const t = await getTranslations("HomePage");
  const quarters = await listQuarters().catch(() => []);

  return (
    <main>
      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden bg-[var(--navy)] text-white">
        {/* The one bold visual move: a drifting skyline silhouette,
            built from real SVG shapes in the brand palette — not a
            stock photo, not a generic gradient blob. */}
        <svg
          className="absolute inset-x-0 bottom-0 w-full h-40 md:h-56 opacity-90 animate-drift"
          viewBox="0 0 1200 200"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect x="40" y="90" width="70" height="110" fill="#22335c" />
          <rect x="130" y="60" width="50" height="140" fill="#c9a227" fillOpacity="0.25" />
          <rect x="200" y="110" width="90" height="90" fill="#22335c" />
          <rect x="310" y="40" width="46" height="160" fill="#22335c" />
          <rect x="380" y="75" width="60" height="125" fill="#a8502e" fillOpacity="0.3" />
          <rect x="470" y="100" width="80" height="100" fill="#22335c" />
          <rect x="580" y="55" width="55" height="145" fill="#22335c" />
          <rect x="660" y="85" width="70" height="115" fill="#c9a227" fillOpacity="0.25" />
          <rect x="760" y="115" width="90" height="85" fill="#22335c" />
          <rect x="880" y="65" width="50" height="135" fill="#22335c" />
          <rect x="950" y="95" width="75" height="105" fill="#a8502e" fillOpacity="0.3" />
          <rect x="1050" y="70" width="60" height="130" fill="#22335c" />
          <rect x="1130" y="105" width="50" height="95" fill="#22335c" />
        </svg>

        <div className="relative max-w-5xl mx-auto px-4 pt-16 pb-56 md:pt-24 md:pb-64 text-center">
          <h1
            className="font-[family-name:var(--font-display)] text-4xl md:text-6xl font-semibold leading-tight mb-5 animate-rise-in"
            style={{ animationDelay: "0ms" }}
          >
            {t("heroTitle")}
          </h1>
          <p
            className="text-gray-300 mb-10 hidden md:block text-lg max-w-2xl mx-auto animate-rise-in"
            style={{ animationDelay: "120ms" }}
          >
            {t("heroSubtitle")}
          </p>

          {/* The hero search form — this IS the priority on mobile;
              everything else on this page is secondary. */}
          <form
            action="/search"
            method="GET"
            className="bg-white text-left rounded-2xl p-5 md:p-6 flex flex-col gap-3 shadow-2xl shadow-black/20 animate-rise-in"
            style={{ animationDelay: "240ms" }}
          >
            {/* Rent vs Sale — the platform's two most basic categories,
                given their own explicit toggle rather than buried
                inside a generic dropdown. */}
            <div className="flex rounded-xl overflow-hidden border border-gray-200">
              <label className="flex-1">
                <input type="radio" name="listing_type" value="RENT" defaultChecked className="peer sr-only" />
                <span className="block text-center py-2.5 text-gray-700 peer-checked:bg-[var(--navy)] peer-checked:text-white cursor-pointer transition-colors font-medium">
                  {t("forRent")}
                </span>
              </label>
              <label className="flex-1">
                <input type="radio" name="listing_type" value="SALE" className="peer sr-only" />
                <span className="block text-center py-2.5 text-gray-700 peer-checked:bg-[var(--navy)] peer-checked:text-white cursor-pointer transition-colors font-medium">
                  {t("forSale")}
                </span>
              </label>
            </div>

            <div className="flex flex-col md:flex-row gap-3">
              <select name="quarter" className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800" defaultValue="">
                <option value="" disabled>{t("chooseNeighborhood")}</option>
                {quarters.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name} ({q.village_name})
                  </option>
                ))}
              </select>

              <select name="property_type" className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800" defaultValue="">
                <option value="">{t("anyPropertyType")}</option>
                <option value="HOUSE">{t("house")}</option>
                <option value="LAND">{t("land")}</option>
                <option value="SHOP">{t("shop")}</option>
              </select>
              <select name="finish_level" className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800" defaultValue="">
                <option value="">{t("modernOrStandard")}</option>
                <option value="MODERN">{t("modern")}</option>
                <option value="STANDARD">{t("standard")}</option>
              </select>

              <button
                type="submit"
                className="bg-[var(--clay)] text-white font-semibold px-6 py-2.5 rounded-xl transition-all duration-200 hover:brightness-110 hover:scale-[1.02]"
              >
                {t("search")}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Trust strip — desktop only, per the responsive design table
          ("hidden — moved to footer on mobile"). Pulled up over the
          hero's lower edge so it reads as one continuous surface,
          not a hard seam between sections. */}
      <section className="hidden md:block relative -mt-10">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-white rounded-2xl shadow-lg shadow-black/5 py-5 flex justify-center gap-10 text-sm text-gray-600">
            <span>{t("trustVerifiedListings")}</span>
            <span>{t("trustSecurePayments")}</span>
            <span>{t("trustLocalAgents")}</span>
          </div>
        </div>
      </section>

      {/* Explore more — secondary, clearly not the main event. Every
          category here is real and bookable, but rent/sale above is
          what a first-time visitor should understand this platform is
          for, before discovering it's ALSO a hotel/venue/hostel/
          guest-house marketplace. */}
      <section className="py-16 px-4 bg-[var(--paper)]">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--navy)] mb-6">
            {t("exploreMore")}
          </h2>
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
                className="bg-white border border-gray-200 rounded-xl p-5 text-center text-sm font-medium text-[var(--navy)] transition-all duration-200 hover:shadow-md hover:border-[var(--gold)] hover:-translate-y-0.5"
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

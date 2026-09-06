import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listQuarters, searchListings, listTestimonials } from "@/lib/api";
import PropertyCard from "@/components/PropertyCard";
import type { Metadata } from "next";

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
 * Home page — extended toward the real estate industry's own common
 * home page pattern (neighborhood-first exploration, featured listings,
 * a real trust section, genuine social proof), applied to Oaziland's
 * own navy/gold/clay identity rather than any other platform's colors
 * or branding. Every new section below uses real, live data — no
 * fabricated listings, no placeholder testimonials, no invented
 * neighborhood names — matching the same discipline as every other
 * page built this session.
 */
export default async function HomePage() {
  const t = await getTranslations("HomePage");
  const quarters = await listQuarters().catch(() => []);
  const featuredListings = await searchListings({}).then((data) => data.results.slice(0, 6)).catch(() => []);
  const testimonials = await listTestimonials().then((data) => data.results.slice(0, 3)).catch(() => []);

  return (
    <main>
      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden bg-[var(--navy)] text-white">
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

          <form
            action="/search"
            method="GET"
            className="bg-white text-left rounded-2xl p-5 md:p-6 flex flex-col gap-3 shadow-2xl shadow-black/20 animate-rise-in"
            style={{ animationDelay: "240ms" }}
          >
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
                  <option key={q.id} value={q.id}>{q.name} ({q.village_name})</option>
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

      {/* Trust strip */}
      <section className="hidden md:block relative -mt-10">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-white rounded-2xl shadow-lg shadow-black/5 py-5 flex justify-center gap-10 text-sm text-gray-600">
            <span>{t("trustVerifiedListings")}</span>
            <span>{t("trustSecurePayments")}</span>
            <span>{t("trustLocalAgents")}</span>
          </div>
        </div>
      </section>

      {/* ================= POPULAR NEIGHBORHOODS ================= */}
      {/* WHY this comes right after the hero: the single most common
          real estate home page pattern is neighborhood-first
          exploration — someone who doesn't yet know exactly what
          they want often starts from "where," not "what." Real
          quarters from the actual database, never invented names. */}
      {quarters.length > 0 && (
        <section className="py-14 px-4 bg-white">
          <div className="max-w-6xl mx-auto">
            <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--navy)] mb-1">{t("popularNeighborhoods")}</h2>
            <p className="text-gray-500 mb-6">{t("popularNeighborhoodsSubtitle")}</p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {quarters.slice(0, 10).map((q) => (
                <Link
                  key={q.id}
                  href={{ pathname: "/search", query: { quarter: q.id } }}
                  className="shrink-0 border border-gray-200 rounded-xl px-5 py-4 min-w-[160px] transition-all duration-200 hover:border-[var(--gold)] hover:shadow-md hover:-translate-y-0.5"
                >
                  <p className="font-semibold text-[var(--navy)]">{q.name}</p>
                  <p className="text-xs text-gray-500">{q.village_name}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ================= FEATURED LISTINGS ================= */}
      {/* Real, live, published listings — the same PropertyCard used
          on Search, with its real photo carousel and icon stat row —
          never a hardcoded/fabricated "example" listing. */}
      {featuredListings.length > 0 && (
        <section className="py-14 px-4 bg-[var(--paper)]">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--navy)] mb-1">{t("featuredListings")}</h2>
                <p className="text-gray-500">{t("featuredListingsSubtitle")}</p>
              </div>
              <Link href="/search" className="text-sm font-semibold text-[var(--navy)] underline hover:text-[var(--gold)] whitespace-nowrap">
                {t("viewAllListings")}
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {featuredListings.map((listing) => <PropertyCard key={listing.id} listing={listing} />)}
            </div>
          </div>
        </section>
      )}

      {/* Explore more categories */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--navy)] mb-6">
            {t("exploreMore")}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { href: "/hotels", label: t("categoryHotels"), icon: "🏨" },
              { href: "/student-hostels", label: t("categoryStudentHostels"), icon: "🎓" },
              { href: "/events", label: t("categoryEventVenues"), icon: "🎉" },
              { href: "/guest-houses", label: t("categoryGuestHouses"), icon: "🏡" },
              { href: "/marketplace", label: t("categoryMarketplace"), icon: "🏬" },
              { href: "/taskln-service", label: t("categoryTasklnService"), icon: "🛠️" },
              { href: "/wanted", label: t("categoryWanted"), icon: "🔍" },
              { href: "/careers", label: t("categoryCareers"), icon: "💼" },
            ].map((category) => (
              <Link
                key={category.href}
                href={category.href}
                className="bg-white border border-gray-200 rounded-xl p-5 text-center transition-all duration-200 hover:shadow-md hover:border-[var(--gold)] hover:-translate-y-0.5"
              >
                <div className="text-2xl mb-2">{category.icon}</div>
                <p className="text-sm font-medium text-[var(--navy)]">{category.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ================= WHY OAZILAND ================= */}
      <section className="py-16 px-4 bg-[var(--navy)] text-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-[family-name:var(--font-display)] text-2xl mb-10 text-center">{t("whyOaziland")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: "✓", title: t("whyVerifiedTitle"), desc: t("whyVerifiedDesc") },
              { icon: "🔒", title: t("whySecureTitle"), desc: t("whySecureDesc") },
              { icon: "🤝", title: t("whyLocalTitle"), desc: t("whyLocalDesc") },
            ].map((item) => (
              <div key={item.title} className="text-center">
                <div className="w-12 h-12 rounded-full bg-[var(--gold)] text-[var(--navy)] flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {item.icon}
                </div>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-gray-300">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= TESTIMONIALS ================= */}
      {/* Real reviews from completed bookings — never fabricated
          placeholder quotes. Section simply doesn't render until
          real ones exist. */}
      {testimonials.length > 0 && (
        <section className="py-16 px-4 bg-[var(--paper)]">
          <div className="max-w-6xl mx-auto">
            <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--navy)] mb-8 text-center">{t("testimonialsTitle")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {testimonials.map((testimonial, i) => (
                <div key={i} className="bg-white rounded-xl p-6 border border-gray-200">
                  <p className="text-[var(--gold)] mb-3">{"★".repeat(testimonial.score)}</p>
                  <p className="text-gray-700 text-sm mb-4 italic">&ldquo;{testimonial.text}&rdquo;</p>
                  <p className="font-semibold text-[var(--navy)] text-sm">{testimonial.author_name}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

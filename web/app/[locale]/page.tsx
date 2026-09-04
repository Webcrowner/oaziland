import { getTranslations } from "next-intl/server";
import { listQuarters } from "@/lib/api";

/**
 * Home page — Page 1 of Prompt 17. Server Component: quarters are
 * fetched at request time so the search form's dropdown is always
 * populated with real, current data, not a hardcoded list.
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
          <form action="/search" method="GET" className="bg-white rounded-lg p-4 flex flex-col md:flex-row gap-3">
            <select name="quarter" className="flex-1 border rounded px-3 py-2 text-gray-800" defaultValue="">
              <option value="" disabled>{t("chooseNeighborhood")}</option>
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
    </main>
  );
}

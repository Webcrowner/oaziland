import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Acheter une Propriété au Cameroun | Oaziland" : "Buy a Property in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Des maisons, terrains et boutiques vérifiés à vendre à travers le Cameroun."
      : "Verified houses, land, and shops for sale across Cameroon.",
  };
}

/**
 * A dedicated landing page for buyers — deliberately thin, reusing the
 * EXISTING search infrastructure (pre-filtered to listing_type=SALE)
 * rather than building a second, parallel property system.
 */
export default async function BuyPage() {
  const t = await getTranslations("BuyPage");

  return (
    <main className="bg-[var(--navy)] text-white py-20 px-4 text-center">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-bold mb-4">{t("title")}</h1>
        <p className="text-gray-300 mb-8">{t("subtitle")}</p>
        <Link
          href={{ pathname: "/search", query: { listing_type: "SALE" } }}
          className="inline-block bg-[var(--gold)] text-[var(--navy)] font-semibold px-8 py-3 rounded transition-all duration-150 hover:opacity-90 hover:scale-[1.03]"
        >
          {t("cta")}
        </Link>
      </div>
    </main>
  );
}

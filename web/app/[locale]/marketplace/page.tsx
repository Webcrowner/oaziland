import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Marché — Entrepôts, Boutiques, Entreprises, Voitures | Oaziland" : "Marketplace — Warehouses, Stores, Businesses, Cars | Oaziland",
    description: locale === "fr"
      ? "Achetez, vendez ou louez des entrepôts, boutiques, entreprises et voitures, plus des courses réelles à travers le Cameroun."
      : "Buy, sell, or rent warehouses, stores, businesses, and cars, plus real rides across Cameroon.",
  };
}

const CATEGORIES = [
  { href: "/marketplace/warehouses", icon: "🏭", titleKey: "warehouses", descKey: "warehousesDesc" },
  { href: "/marketplace/stores", icon: "🏬", titleKey: "stores", descKey: "storesDesc" },
  { href: "/marketplace/businesses", icon: "💼", titleKey: "businesses", descKey: "businessesDesc" },
  { href: "/marketplace/cars", icon: "🚗", titleKey: "cars", descKey: "carsDesc" },
] as const;

/**
 * The Marketplace hub — a real gap this closes: four listing
 * categories and a full ride-hailing system had real backend logic
 * with zero page to reach any of it. Deliberately a calm, editorial
 * landing rather than a dense grid: each category gets real room to
 * explain what it actually is, since none of these are as
 * self-explanatory as "Hotels" or "Cars" alone would suggest — a
 * "business" listing here is a going concern, not a building.
 */
export default async function MarketplacePage() {
  const t = await getTranslations("MarketplacePage");

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <div className="text-center mb-12">
        <h1 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl text-[var(--navy)] mb-3">{t("title")}</h1>
        <p className="text-gray-500 max-w-xl mx-auto">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-14">
        {CATEGORIES.map((category) => (
          <Link
            key={category.href}
            href={category.href}
            className="group border border-gray-200 rounded-2xl p-6 bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-[var(--gold)]"
          >
            <div className="text-3xl mb-3">{category.icon}</div>
            <h2 className="font-semibold text-[var(--navy)] text-lg mb-1 group-hover:text-[var(--gold)] transition-colors">{t(category.titleKey)}</h2>
            <p className="text-sm text-gray-500">{t(category.descKey)}</p>
          </Link>
        ))}
      </div>

      {/* OaziGo gets its own distinct visual treatment — it's a
          transaction, not a listing category, and deserves to read
          differently rather than sitting in the same grid. */}
      <div className="rounded-2xl bg-[var(--navy)] text-white p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl mb-2">{t("oaziGoTitle")}</h2>
          <p className="text-gray-300 max-w-md">{t("oaziGoDesc")}</p>
        </div>
        <Link href="/oazigo" className="bg-[var(--gold)] text-[var(--navy)] font-semibold px-6 py-3 rounded-lg whitespace-nowrap hover:brightness-105 transition-all">
          {t("openOaziGo")}
        </Link>
      </div>
    </main>
  );
}

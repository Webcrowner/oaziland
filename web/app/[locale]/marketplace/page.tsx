import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Metadata } from "next";
import MarketplaceBrowser from "@/components/MarketplaceBrowser";
import CartLink from "@/components/CartLink";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Marché — Articles, Voitures, Boutiques, Entrepôts | Oaziland" : "Marketplace — Goods, Cars, Stores, Warehouses | Oaziland",
    description: locale === "fr"
      ? "Achetez et vendez des articles, voitures, boutiques, entrepôts et entreprises à travers le Cameroun."
      : "Buy and sell goods, cars, stores, warehouses, and businesses across Cameroon.",
  };
}

/**
 * The Marketplace index: anyone can browse and search everything for sale or rent (public, no account
 * needed) and verified users can post their own items from the "Sell" button.
 */
export default async function MarketplacePage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const t = await getTranslations("MarketplacePage");
  const { category } = await searchParams;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--navy)] md:text-4xl">{t("title")}</h1>
          <p className="max-w-xl text-sm text-slate-500 md:text-base">{t("subtitle")}</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <CartLink />
          <Link href="/marketplace/sell" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl gold-gradient px-5 py-3 text-sm font-bold text-[var(--navy)] shadow-sm sm:flex-none">
            + {t("sellAnItem")}
          </Link>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-[var(--navy)]">
        <Link href="/marketplace/deals" className="inline-flex min-h-10 items-center rounded-full bg-red-600 px-3.5 text-white">⚡ {t("flashDeals")}</Link>
        <Link href="/marketplace/my-listings" className="inline-flex min-h-10 items-center underline">{t("myListings")}</Link>
        <Link href="/marketplace/orders" className="inline-flex min-h-10 items-center underline">{t("myOrders")}</Link>
        <Link href="/marketplace/shop-settings" className="inline-flex min-h-10 items-center underline">{t("myShop")}</Link>
      </div>

      <MarketplaceBrowser initialCategory={category} />

      <div className="mt-12 flex flex-col items-start justify-between gap-5 rounded-2xl bg-[var(--navy)] p-6 text-white md:flex-row md:items-center md:p-8">
        <div>
          <h2 className="mb-2 font-[family-name:var(--font-display)] text-xl md:text-2xl">{t("oaziGoTitle")}</h2>
          <p className="max-w-md text-sm text-gray-300 md:text-base">{t("oaziGoDesc")}</p>
        </div>
        <Link href="/oazigo" className="w-full whitespace-nowrap rounded-lg bg-[var(--gold)] px-6 py-3 text-center font-semibold text-[var(--navy)] transition-all hover:brightness-105 md:w-auto">
          {t("openOaziGo")}
        </Link>
      </div>
    </main>
  );
}


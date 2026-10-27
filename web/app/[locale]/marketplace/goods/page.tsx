import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import MarketplaceBrowser from "@/components/MarketplaceBrowser";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Articles à vendre | Oaziland" : "Goods for sale | Oaziland",
    description: locale === "fr"
      ? "Téléphones, électronique, meubles, vêtements et plus — achetez et vendez à travers le Cameroun."
      : "Phones, electronics, furniture, fashion and more — buy and sell across Cameroon.",
  };
}

export default async function GoodsMarketplacePage() {
  const t = await getTranslations("MarketplaceGoods");

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--navy)] md:text-4xl">{t("pageTitle")}</h1>
          <p className="max-w-xl text-sm text-slate-500 md:text-base">{t("pageSubtitle")}</p>
        </div>
        <Link href="/marketplace/sell" className="inline-flex w-full items-center justify-center rounded-xl gold-gradient px-5 py-3 text-sm font-bold text-[var(--navy)] shadow-sm sm:w-auto">
          + {t("sellCta")}
        </Link>
      </div>
      <MarketplaceBrowser initialCategory="goods" />
    </main>
  );
}

import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import MarketplaceBrowser from "@/components/MarketplaceBrowser";

const COPY = {
  warehouses: { title: "warehousesTitle", subtitle: "warehousesSubtitle", cta: "listAWarehouse" },
  stores: { title: "storesTitle", subtitle: "storesSubtitle", cta: "listAStore" },
  businesses: { title: "businessesTitle", subtitle: "businessesSubtitle", cta: "listABusiness" },
  cars: { title: "carsTitle", subtitle: "carsSubtitle", cta: "listACar" },
} as const;

/** A category's own URL (/marketplace/cars, …): the shared marketplace browser opened on that category's tab. */
export default async function MarketplaceCategoryPage({ category }: { category: keyof typeof COPY }) {
  const t = await getTranslations("MarketplaceCategoryPage");
  const copy = COPY[category];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--navy)] md:text-4xl">{t(copy.title)}</h1>
          <p className="max-w-xl text-sm text-slate-500 md:text-base">{t(copy.subtitle)}</p>
        </div>
        <Link href={`/marketplace/sell/${category}`} className="inline-flex w-full items-center justify-center rounded-xl gold-gradient px-5 py-3 text-sm font-bold text-[var(--navy)] shadow-sm sm:w-auto">
          + {t(copy.cta)}
        </Link>
      </div>
      <MarketplaceBrowser initialCategory={category} />
      {category === "cars" && (
        <p className="mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          🚕 {t("carsOnOaziGo")}{" "}
          <Link href="/oazigo/cars" className="font-semibold text-[var(--navy)] underline">{t("carsOnOaziGoLink")}</Link>
        </p>
      )}
    </main>
  );
}

"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { IconShoppingBag } from "@/components/Icons";
import MarketplaceBrowser from "@/components/MarketplaceBrowser";

/** Cars for sale and rent inside OaziGo — the very same car listings as the Marketplace, not a copy. */
export default function OaziGoCarsPage() {
  const t = useTranslations("OaziGoPage");

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-lg shadow-slate-900/10 sm:px-8 sm:py-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20">
              <IconShoppingBag size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("carsTitle")}</h1>
              <p className="mt-1 text-sm text-slate-300">{t("carsSubtitle")}</p>
              <Link href="/marketplace/cars" className="mt-1.5 inline-block text-xs font-semibold text-amber-300 underline hover:text-amber-200">
                {t("carsAlsoInMarketplace")}
              </Link>
            </div>
          </div>
          <Link href="/marketplace/sell/cars" className="inline-flex shrink-0 items-center rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-sm hover:bg-amber-300 transition-colors">
            + {t("carsListYours")}
          </Link>
        </div>
      </section>
      <MarketplaceBrowser lockedCategory="cars" />
    </div>
  );
}

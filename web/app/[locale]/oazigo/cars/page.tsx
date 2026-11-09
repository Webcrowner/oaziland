"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import MarketplaceBrowser from "@/components/MarketplaceBrowser";
import { cardCls } from "@/components/oazigo/styles";

/** Cars for sale and rent inside OaziGo — the very same car listings as the Marketplace, not a copy. */
export default function OaziGoCarsPage() {
  const t = useTranslations("OaziGoPage");

  return (
    <div className="flex flex-col gap-5">
      <div className={`${cardCls} flex flex-wrap items-start justify-between gap-4`}>
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight text-slate-900">{t("carsTitle")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("carsSubtitle")}</p>
          <Link href="/marketplace/cars" className="mt-2 inline-block text-xs font-semibold text-slate-500 underline hover:text-slate-800">
            {t("carsAlsoInMarketplace")}
          </Link>
        </div>
        <Link href="/marketplace/sell/cars" className="inline-flex shrink-0 items-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-amber-300 hover:bg-slate-800">
          + {t("carsListYours")}
        </Link>
      </div>
      <MarketplaceBrowser lockedCategory="cars" />
    </div>
  );
}

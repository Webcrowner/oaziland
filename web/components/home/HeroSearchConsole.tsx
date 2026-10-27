"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { PopularQuarter, Quarter } from "@/lib/api";
import Button from "@/components/ui/Button";
import LoadError from "@/components/ui/LoadError";
import { IconSearch, IconHome, IconBuilding, IconGraduationCap, IconHotel } from "@/components/Icons";

interface HeroSearchConsoleProps {
  quarters: Quarter[];
  popularQuarters: PopularQuarter[];
  areasFailed?: boolean;
}

export default function HeroSearchConsole({ quarters, popularQuarters, areasFailed = false }: HeroSearchConsoleProps) {
  const t = useTranslations("HeroSearch");
  const locale = useLocale();
  const [listingType, setListingType] = useState<"RENT" | "SALE">("RENT");
  const field = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600";
  const tab = "flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600";

  return (
    <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xl sm:p-6">
      <nav aria-label={t("searchType")} className="mb-5 grid grid-cols-2 gap-2 border-b border-slate-200 pb-4 sm:grid-cols-4">
        {(["RENT", "SALE"] as const).map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={listingType === type}
            onClick={() => setListingType(type)}
            className={`${tab} ${listingType === type ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            {type === "RENT" ? <IconHome size={18} /> : <IconBuilding size={18} />}
            {t(type === "RENT" ? "rent" : "buy")}
          </button>
        ))}
        <Link href="/student-hostels" className={`${tab} bg-slate-100 text-slate-700 hover:bg-slate-200`}>
          <IconGraduationCap size={18} />{t("hostels")}
        </Link>
        <Link href="/hotels" className={`${tab} bg-slate-100 text-slate-700 hover:bg-slate-200`}>
          <IconHotel size={18} />{t("hotels")}
        </Link>
      </nav>

      <form action={`/${locale}/search`} method="GET" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="listing_type" value={listingType} />
        <div>
          <label htmlFor="hero-quarter" className="mb-1.5 block text-sm font-semibold text-slate-700">{t("location")}</label>
          <select id="hero-quarter" name="quarter" disabled={areasFailed} className={field}>
            <option value="">{t("allAreas")}</option>
            {Object.entries(
              quarters.reduce<Record<string, Quarter[]>>((groups, quarter) => {
                (groups[quarter.region_name || t("otherAreas")] ??= []).push(quarter);
                return groups;
              }, {})
            ).sort(([a], [b]) => a.localeCompare(b, locale)).map(([region, areas]) => (
              <optgroup key={region} label={region}>
                {areas.map((quarter) => <option key={quarter.id} value={quarter.id}>{quarter.name} ({quarter.village_name})</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="hero-property-type" className="mb-1.5 block text-sm font-semibold text-slate-700">{t("propertyType")}</label>
          <select id="hero-property-type" name="property_type" className={field}>
            <option value="">{t("anyType")}</option>
            {(["HOUSE", "LAND", "SHOP", "BUILDING"] as const).map((type) => <option key={type} value={type}>{t(type)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="hero-budget" className="mb-1.5 block text-sm font-semibold text-slate-700">{t("budget")}</label>
          <input id="hero-budget" name="max_price" type="number" inputMode="numeric" min="0" step="1" placeholder={t("anyBudget")} className={field} />
        </div>
        <div className="flex items-end">
          <Button type="submit" className="min-h-11 w-full gap-2">
            <IconSearch size={18} />{t("search")}
          </Button>
        </div>
      </form>
      {areasFailed && <LoadError message={t("areasFailed")} />}

      {popularQuarters.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 text-sm text-slate-600">
          <span className="font-semibold">{t("popularAreas")}</span>
          {popularQuarters.slice(0, 5).map((quarter) => (
            <Link key={quarter.id} href={`/search?quarter=${quarter.id}&listing_type=${listingType}`} className="inline-flex min-h-11 items-center rounded-lg bg-slate-100 px-3 hover:bg-amber-50 hover:text-amber-900">
              {quarter.name} ({quarter.area})
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

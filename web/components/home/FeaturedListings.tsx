"use client";
import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Listing } from "@/lib/api";
import PropertyCard from "@/components/PropertyCard";
import { IconSparkles } from "@/components/Icons";

/** Featured live listings, filterable by the property types that actually exist. */
export default function FeaturedListings({ liveListings }: { liveListings: Listing[] }) {
  const t = useTranslations("HomePage");
  const [filterType, setFilterType] = useState("ALL");

  const types = useMemo(() => Array.from(new Set(liveListings.map((l) => l.property_asset.type))), [liveListings]);
  const visible = filterType === "ALL" ? liveListings : liveListings.filter((l) => l.property_asset.type === filterType);

  return (
    <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-100/70 border-b border-slate-200/80">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-1.5">
              <IconSparkles size={12} className="text-amber-600" />
              <span>{t("featuredEyebrow")}</span>
            </div>
            <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-slate-900">
              {t("featuredTitleV2")}
            </h2>
          </div>

          <Link href="/search" className="text-xs sm:text-sm font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1">
            <span>{t("seeAllListings")}</span>
            <span>&rarr;</span>
          </Link>
        </div>

        {liveListings.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
            <h3 className="font-bold text-slate-900 mb-1">{t("featuredEmptyTitle")}</h3>
            <p className="text-sm text-slate-500 mb-5">{t("featuredEmptyDesc")}</p>
            <Link
              href="/list-property"
              className="inline-block gold-gradient text-[var(--navy)] text-sm font-bold px-5 py-2.5 rounded-xl hover:shadow-lg transition-transform active:scale-95"
            >
              {t("ctaListProperty")}
            </Link>
          </div>
        ) : (
          <>
            {types.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-6 text-xs font-bold">
                {["ALL", ...types].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFilterType(type)}
                    className={`whitespace-nowrap px-3.5 py-1.5 rounded-xl border transition-all ${
                      filterType === type
                        ? "bg-amber-400 border-amber-400 text-slate-950 shadow-sm"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    {type === "ALL" ? t("filterAll") : type.replace(/_/g, " ").toLowerCase()}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {visible.map((listing) => (
                <PropertyCard key={listing.id} listing={listing} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

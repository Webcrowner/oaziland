import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { IconMapPin, IconArrowUpRight, IconSparkles } from "@/components/Icons";
import type { PopularQuarter } from "@/lib/api";

/** Neighbourhoods ranked by real published listings, with the real rent range in each. */
export default async function PopularNeighborhoods({ quarters }: { quarters: PopularQuarter[] }) {
  const t = await getTranslations("HomePage");
  if (quarters.length === 0) return null;

  return (
    <section className="py-16 sm:py-20 px-4 sm:px-6 bg-white border-b border-slate-200/80">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-1.5">
              <IconSparkles size={12} className="text-amber-600" />
              <span>{t("neighborhoodsEyebrow")}</span>
            </div>
            <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-slate-900">
              {t("neighborhoodsTitle")}
            </h2>
          </div>

          <Link
            href="/search"
            className="text-xs sm:text-sm font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1 group self-start sm:self-auto"
          >
            <span>{t("seeAllListings")}</span>
            <span className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quarters.map((q) => (
            <Link
              key={q.id}
              href={`/search?quarter=${q.id}`}
              className="group border border-slate-200 rounded-2xl p-5 bg-slate-50/50 hover:bg-white hover:border-amber-400 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-slate-200/70 text-slate-700">
                    {q.area}
                  </span>
                  <IconMapPin size={14} className="text-slate-400 group-hover:text-amber-500 transition-colors" />
                </div>
                <h4 className="text-base font-bold text-slate-900 group-hover:text-amber-600 transition-colors mb-1">
                  {q.name}
                </h4>
                <p className="text-xs text-amber-800 font-semibold mb-2">{t("neighborhoodListings", { count: q.listing_count })}</p>
              </div>

              <div className="pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs">
                <div>
                  {q.min_rent_xaf && q.max_rent_xaf && (
                    <>
                      <span className="text-[10px] text-slate-400 block font-medium">{t("neighborhoodRentRange")}</span>
                      <span className="font-bold text-slate-800 text-[11px]">
                        {Number(q.min_rent_xaf) === Number(q.max_rent_xaf)
                          ? `${Number(q.min_rent_xaf).toLocaleString()} XAF`
                          : `${Number(q.min_rent_xaf).toLocaleString()} – ${Number(q.max_rent_xaf).toLocaleString()} XAF`}
                      </span>
                    </>
                  )}
                </div>
                <div className="w-7 h-7 rounded-lg bg-amber-50 group-hover:bg-amber-400 group-hover:text-slate-950 flex items-center justify-center text-amber-700 transition-colors">
                  <IconArrowUpRight size={14} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

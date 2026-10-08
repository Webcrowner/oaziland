import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listAgents } from "@/lib/api";
import EmptyState from "@/components/ui/EmptyState";
import { IconStar, IconShieldCheck, IconBuilding, IconChevronRight, IconBriefcase } from "@/components/Icons";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Nos Agents Immobiliers | Oaziland" : "Our Real Estate Agents | Oaziland",
    description: locale === "fr" ? "Des agents immobiliers vérifiés à travers le Cameroun." : "Verified real estate agents across Cameroon.",
  };
}

/**
 * Agents directory — brought onto the shared UI foundation
 * (PageHeader, EmptyState, Badge), continuing the page-by-page pass.
 */
export default async function AgentsDirectoryPage() {
  const t = await getTranslations("AgentsDirectoryPage");
  const data = await listAgents().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-8">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative p-6 sm:p-10 flex items-center gap-5">
          <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
            <IconBriefcase size={28} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-sm sm:text-base text-slate-400">{t("subtitle")}</p>
          </div>
        </div>
      </section>

      {data.results.length === 0 ? (
        <EmptyState icon={<IconBriefcase size={28} />} title={t("noAgentsYet")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {data.results.map((agent) => (
            <Link
              key={agent.user_id} href={`/agents/${agent.user_id}`}
              className="group rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-amber-300 hover:shadow-lg"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-xl font-black text-amber-300">
                  {agent.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-black tracking-tight text-slate-900">{agent.full_name}</p>
                  {agent.agency_name && (
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
                      <IconBuilding size={12} className="shrink-0" />
                      {agent.agency_name}
                    </p>
                  )}
                </div>
                <IconChevronRight size={18} className="shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-500" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {agent.is_kyc_verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                    <IconShieldCheck size={13} /> {t("verifiedBadge")}
                  </span>
                )}
                {agent.average_rating && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
                    <IconStar size={13} className="text-amber-500" /> {agent.average_rating} ({agent.rating_count})
                  </span>
                )}
              </div>

              <p className="mt-4 border-t border-slate-100 pt-3 text-sm font-semibold text-slate-600">
                {agent.active_listing_count === 1 ? t("listingsCount", { count: agent.active_listing_count }) : t("listingsCountOther", { count: agent.active_listing_count })}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

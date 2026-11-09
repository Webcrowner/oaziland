import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AGENT_LANGUAGES, AGENT_SPECIALTIES, listAgents, type AgentDirectoryEntry } from "@/lib/api";
import EmptyState from "@/components/ui/EmptyState";
import { IconStar, IconShieldCheck, IconBuilding, IconChevronRight, IconBriefcase, IconMapPin, IconSearch } from "@/components/Icons";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Nos Agents Immobiliers | Oaziland" : "Our Real Estate Agents | Oaziland",
    description: locale === "fr" ? "Des agents immobiliers vérifiés à travers le Cameroun." : "Verified real estate agents across Cameroon.",
  };
}

type Search = { q?: string; specialty?: string; language?: string; verified?: string; page?: string };

/** Searchable agents directory: each card shows who the agent is and their latest listings, LinkedIn-style. */
export default async function AgentsDirectoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getTranslations("AgentsDirectoryPage");
  const search = await searchParams;
  const page = Math.max(1, Number(search.page) || 1);
  const filters = {
    q: (search.q ?? "").slice(0, 100), specialty: search.specialty ?? "", language: search.language ?? "",
    verified: search.verified === "1", page,
  };
  const data = await listAgents(filters).catch(() => ({ count: 0, page, has_more: false, results: [] as AgentDirectoryEntry[] }));
  const filtered = Boolean(filters.q || filters.specialty || filters.language || filters.verified);

  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.specialty) params.set("specialty", filters.specialty);
    if (filters.language) params.set("language", filters.language);
    if (filters.verified) params.set("verified", "1");
    if (target > 1) params.set("page", String(target));
    return params.size ? `/agents?${params}` : "/agents";
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
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

      <form method="get" role="search" aria-label={t("searchLabel")} className="mb-6 grid grid-cols-1 gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto_auto] lg:items-end">
        <label className="text-xs font-bold text-slate-600">
          {t("searchLabel")}
          <span className="relative mt-1 block">
            <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input name="q" defaultValue={filters.q} placeholder={t("searchPlaceholder")} className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm font-medium" />
          </span>
        </label>
        <label className="text-xs font-bold text-slate-600">
          {t("specialtyLabel")}
          <select name="specialty" defaultValue={filters.specialty} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium">
            <option value="">{t("any")}</option>
            {AGENT_SPECIALTIES.map((code) => <option key={code} value={code}>{t(`specialty_${code}`)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">
          {t("languageLabel")}
          <select name="language" defaultValue={filters.language} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium">
            <option value="">{t("any")}</option>
            {AGENT_LANGUAGES.map((code) => <option key={code} value={code}>{t(`language_${code}`)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 lg:pb-2">
          <input type="checkbox" name="verified" value="1" defaultChecked={filters.verified} className="h-4 w-4 accent-amber-500" />
          {t("verifiedOnly")}
        </label>
        <div className="flex gap-2">
          <button type="submit" className="flex-1 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-amber-300 hover:bg-slate-800">{t("search")}</button>
          {filtered && <Link href="/agents" className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">{t("clear")}</Link>}
        </div>
      </form>

      <p className="mb-4 text-sm text-slate-500" aria-live="polite">{t("resultCount", { count: data.count })}</p>

      {data.results.length === 0 ? (
        <EmptyState icon={<IconBriefcase size={28} />} title={filtered ? t("noMatches") : t("noAgentsYet")} />
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {data.results.map((agent) => (
            <li key={agent.user_id} className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-start gap-4">
                {agent.profile_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user uploads from arbitrary storage hosts
                  <img src={agent.profile_image_url} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-2xl font-black text-amber-300" aria-hidden>
                    {agent.full_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <Link href={`/agents/${agent.user_id}`} className="text-lg font-black tracking-tight text-slate-900 hover:text-amber-700">
                    {agent.full_name}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {agent.agency_name && <span className="inline-flex items-center gap-1"><IconBuilding size={12} />{agent.agency_name}</span>}
                    {agent.years_experience !== null && <span>{t("yearsExperience", { count: agent.years_experience })}</span>}
                    {agent.areas_served.length > 0 && (
                      <span className="inline-flex items-center gap-1"><IconMapPin size={12} />{agent.areas_served.slice(0, 3).map((a) => a.name).join(", ")}{agent.areas_served.length > 3 ? ` +${agent.areas_served.length - 3}` : ""}</span>
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {agent.is_kyc_verified && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700"><IconShieldCheck size={12} /> {t("verifiedBadge")}</span>
                    )}
                    {agent.average_rating !== null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800"><IconStar size={12} className="text-amber-500" /> {agent.average_rating} ({agent.rating_count})</span>
                    )}
                    {agent.has_intro_video && <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-bold text-sky-800">▶ {t("introVideo")}</span>}
                    {agent.specialties.slice(0, 3).map((code) => (
                      <span key={code} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{t(`specialty_${code}`)}</span>
                    ))}
                  </div>
                </div>
              </div>

              {agent.bio && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{agent.bio}</p>}

              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t("listingsCountOther", { count: agent.active_listing_count })}</p>
                {agent.listing_preview.length === 0 ? (
                  <p className="text-sm text-slate-400">{t("noListingsYet")}</p>
                ) : (
                  <ul className="grid grid-cols-3 gap-2">
                    {agent.listing_preview.map((listing) => (
                      <li key={listing.id}>
                        <Link href={listing.path} className="group block overflow-hidden rounded-xl border border-slate-200">
                          {listing.photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element -- listing photos from arbitrary storage hosts
                            <img src={listing.photo_url} alt="" className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                          ) : (
                            <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-[10px] text-slate-400">{t("noPhoto")}</div>
                          )}
                          <span className="block truncate px-2 pt-1 text-[11px] font-bold text-slate-900">{Number(listing.price_xaf).toLocaleString()} XAF</span>
                          <span className="block truncate px-2 pb-1.5 text-[10px] text-slate-500">{listing.quarter_name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href={`/agents/${agent.user_id}#listings`} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-amber-700 hover:text-amber-800">
                  {agent.active_listing_count > agent.listing_preview.length ? t("seeAllListings", { count: agent.active_listing_count }) : t("viewProfile")}
                  <IconChevronRight size={15} />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || data.has_more) && (
        <nav aria-label={t("pagination")} className="mt-8 flex items-center justify-between">
          {page > 1 ? <Link href={pageHref(page - 1)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">← {t("previous")}</Link> : <span />}
          <span className="text-sm text-slate-500">{t("pageNumber", { page })}</span>
          {data.has_more ? <Link href={pageHref(page + 1)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">{t("next")} →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}

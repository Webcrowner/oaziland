import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  getJobPosting,
  JOB_EMPLOYMENT_TYPES,
  JOB_ROLE_CATEGORIES,
  JOB_WORKPLACE_TYPES,
  listJobPostings,
  listQuarters,
  type JobPosting,
} from "@/lib/api";
import LoadErrorNotice from "@/components/ui/LoadErrorNotice";
import CareersBoard from "@/components/CareersBoard";
import JobPostForm from "@/components/JobPostForm";
import { IconBriefcase, IconSearch } from "@/components/Icons";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}): Promise<Metadata> {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const jobId = sp?.job;
  if (jobId) {
    const job = await getJobPosting(jobId).catch(() => null);
    if (job) {
      const company = job.company_name?.trim() || job.posted_by_name?.trim() || "Oaziland";
      const place = job.quarter_name
        ? job.city_name
          ? `${job.quarter_name}, ${job.city_name}`
          : job.quarter_name
        : "Cameroon";
      const title = `${job.title} — ${company} (${place}) | Oaziland`;
      const description = job.description.replace(/\s+/g, " ").trim().slice(0, 160);
      return {
        title,
        description,
        openGraph: { title, description, type: "website" },
      };
    }
  }
  return {
    title: locale === "fr" ? "Emplois — Immobilier et Hôtellerie | Oaziland" : "Jobs — Real Estate & Hospitality | Oaziland",
    description: locale === "fr"
      ? "Offres d'emploi réelles dans l'immobilier et l'hôtellerie au Cameroun."
      : "Real job openings in real estate and hospitality across Cameroon.",
  };
}

// The API returns 20 jobs per page.
const PAGE_SIZE = 20;

type Search = { q?: string; role?: string; type?: string; workplace?: string; quarter?: string; page?: string; job?: string };

/**
 * Careers — LinkedIn-style Jobs workspace:
 * 1. Compact sticky white search & role-chip subheader (no oversized dark hero pushing jobs below the fold).
 * 2. Three-region workspace below on warm stone background (`#f4f2ee`):
 *    left seeker/employer rail + unified center/right master-detail job board.
 */
export default async function CareersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getTranslations("CareersPage");
  const search = await searchParams;
  const page = Math.max(1, Number(search.page) || 1);
  const filters = {
    q: (search.q ?? "").trim().slice(0, 100),
    roleCategory: (JOB_ROLE_CATEGORIES as readonly string[]).includes(search.role ?? "") ? (search.role as string) : "",
    employmentType: (JOB_EMPLOYMENT_TYPES as readonly string[]).includes(search.type ?? "") ? (search.type as string) : "",
    workplaceType: (JOB_WORKPLACE_TYPES as readonly string[]).includes(search.workplace ?? "") ? (search.workplace as string) : "",
    quarter: /^[0-9a-fA-F-]{32,36}$/.test(search.quarter ?? "") ? (search.quarter as string) : "",
    page,
  };
  const [fetched, quarters] = await Promise.all([
    listJobPostings(filters).catch(() => null),
    listQuarters().catch(() => []),
  ]);
  const loadFailed = fetched === null;
  const data = fetched ?? { count: 0, next: null, results: [] as JobPosting[] };
  const filtered = Boolean(
    filters.q || filters.roleCategory || filters.employmentType || filters.workplaceType || filters.quarter,
  );
  const totalPages = Math.max(1, Math.ceil(data.count / PAGE_SIZE));

  // If a shared `?job=<uuid>` link points to a job on another page or a closed job, fetch it so the link still opens it.
  let linkedJob: JobPosting | null = null;
  let missingLinkedJob = false;
  if (!loadFailed && search.job && !data.results.some((j) => j.id === search.job)) {
    linkedJob = await getJobPosting(search.job).catch(() => null);
    missingLinkedJob = linkedJob === null;
  }

  const buildHref = (opts: { role?: string; page?: number }) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    const nextRole = opts.role !== undefined ? opts.role : filters.roleCategory;
    if (nextRole) params.set("role", nextRole);
    if (filters.employmentType) params.set("type", filters.employmentType);
    if (filters.workplaceType) params.set("workplace", filters.workplaceType);
    if (filters.quarter) params.set("quarter", filters.quarter);
    if (opts.page && opts.page > 1) params.set("page", String(opts.page));
    return params.size ? `/careers?${params}` : "/careers";
  };

  const jsonLd =
    !loadFailed && data.results.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: data.results.map((job, idx) => ({
            "@type": "ListItem",
            position: idx + 1,
            item: {
              "@type": "JobPosting",
              title: job.title,
              description: job.description,
              datePosted: job.posted_at,
              ...(job.closes_at ? { validThrough: job.closes_at } : {}),
              ...(job.employment_type ? { employmentType: job.employment_type } : {}),
              hiringOrganization: {
                "@type": "Organization",
                name: job.company_name?.trim() || job.posted_by_name?.trim() || "Oaziland Partner",
              },
              jobLocation: {
                "@type": "Place",
                address: {
                  "@type": "PostalAddress",
                  addressLocality: job.city_name || job.quarter_name || "Cameroon",
                  addressCountry: "CM",
                },
              },
            },
          })),
        }
      : null;

  return (
    <div className="min-h-[80vh] bg-[#f4f2ee] pb-14">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      )}
      {/* Compact LinkedIn-style white command bar */}
      <div className="border-b border-slate-200 bg-white shadow-2xs">
        <div className="mx-auto max-w-7xl px-4 py-3.5 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Title identity */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-amber-300">
                  <IconBriefcase size={18} />
                </span>
                <div>
                  <h1 className="text-base sm:text-lg font-black tracking-tight text-slate-950 leading-none">
                    {t("title")}
                  </h1>
                  <p className="mt-1 text-xs text-slate-500 line-clamp-1">{t("subtitle")}</p>
                </div>
              </div>
              <div className="xl:hidden shrink-0">
                <JobPostForm />
              </div>
            </div>

            {/* Unified pill search & structured filters form */}
            <form
              method="get"
              role="search"
              aria-label={t("searchLabel")}
              className="flex flex-1 flex-col gap-2 lg:max-w-4xl"
            >
              {filters.roleCategory && <input type="hidden" name="role" value={filters.roleCategory} />}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center rounded-2xl sm:rounded-full border border-slate-300 bg-slate-50/90 p-1.5 focus-within:border-slate-900 focus-within:bg-white transition-colors">
                <label className="relative flex-1 min-w-0">
                  <span className="sr-only">{t("searchLabel")}</span>
                  <IconSearch
                    size={16}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    name="q"
                    defaultValue={filters.q}
                    maxLength={100}
                    placeholder={t("searchPlaceholder")}
                    className="w-full rounded-full bg-transparent py-1.5 pl-9 pr-3 text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none"
                  />
                </label>
                <span aria-hidden="true" className="hidden h-5 w-px bg-slate-300 sm:block" />
                <label className="sm:w-44">
                  <span className="sr-only">{t("neighborhoodLabel")}</span>
                  <select
                    name="quarter"
                    defaultValue={filters.quarter}
                    aria-label={t("neighborhoodLabel")}
                    className="w-full rounded-full bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer"
                  >
                    <option value="">{t("anyNeighborhood")}</option>
                    {quarters.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.village_name ? `${q.village_name} — ${q.name}` : q.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span aria-hidden="true" className="hidden h-5 w-px bg-slate-300 md:block" />
                <label className="sm:w-36">
                  <span className="sr-only">{t("employmentTypeLabel")}</span>
                  <select
                    name="type"
                    defaultValue={filters.employmentType}
                    aria-label={t("employmentTypeLabel")}
                    className="w-full rounded-full bg-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer"
                  >
                    <option value="">{t("anyEmploymentType")}</option>
                    {JOB_EMPLOYMENT_TYPES.map((et) => (
                      <option key={et} value={et}>
                        {t(`empType_${et}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <span aria-hidden="true" className="hidden h-5 w-px bg-slate-300 md:block" />
                <label className="sm:w-32">
                  <span className="sr-only">{t("workplaceTypeLabel")}</span>
                  <select
                    name="workplace"
                    defaultValue={filters.workplaceType}
                    aria-label={t("workplaceTypeLabel")}
                    className="w-full rounded-full bg-transparent px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer"
                  >
                    <option value="">{t("anyWorkplaceType")}</option>
                    {JOB_WORKPLACE_TYPES.map((wt) => (
                      <option key={wt} value={wt}>
                        {t(`workplace_${wt}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="submit"
                    className="flex-1 sm:flex-none rounded-full bg-slate-900 px-5 py-1.5 text-xs sm:text-sm font-bold text-amber-300 hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {t("search")}
                  </button>
                  {filtered && (
                    <Link
                      href="/careers"
                      className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                      {t("clear")}
                    </Link>
                  )}
                </div>
              </div>
            </form>
          </div>

          {/* Horizontal role filter pills */}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5">
            <nav
              aria-label={t("roleLabel")}
              className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <Link
                href={buildHref({ role: "" })}
                aria-current={!filters.roleCategory ? "page" : undefined}
                className={`shrink-0 rounded-full border px-3.5 py-1 text-xs font-bold transition-colors ${
                  !filters.roleCategory
                    ? "border-emerald-800 bg-emerald-800 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-500 hover:bg-slate-50"
                }`}
              >
                {t("anyRole")}
              </Link>
              {JOB_ROLE_CATEGORIES.map((role) => {
                const active = filters.roleCategory === role;
                return (
                  <Link
                    key={role}
                    href={buildHref({ role: active ? "" : role })}
                    aria-current={active ? "page" : undefined}
                    className={`shrink-0 rounded-full border px-3.5 py-1 text-xs font-bold transition-colors ${
                      active
                        ? "border-emerald-800 bg-emerald-800 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:border-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {t(`role_${role}`)}
                  </Link>
                );
              })}
            </nav>

            {!loadFailed && (
              <p className="hidden md:block shrink-0 text-xs font-semibold text-slate-500" aria-live="polite">
                {t("resultCount", { count: data.count })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Main 3-column LinkedIn workspace */}
      <main className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
        {loadFailed ? (
          <LoadErrorNotice message={t("loadFailed")} />
        ) : (
          <CareersBoard
            jobs={data.results}
            totalCount={data.count}
            filtered={filtered}
            initialSelectedId={search.job}
            linkedJob={linkedJob}
            missingLinkedJob={missingLinkedJob}
          />
        )}

        {totalPages > 1 && (
          <nav
            aria-label={t("pageOf", { page, total: totalPages })}
            className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-2xs"
          >
            {page > 1 ? (
              <Link
                href={buildHref({ page: page - 1 })}
                rel="prev"
                className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                ← {t("previousPage")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs font-semibold text-slate-500">
              {t("pageOf", { page, total: totalPages })}
            </span>
            {data.next ? (
              <Link
                href={buildHref({ page: page + 1 })}
                rel="next"
                className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {t("nextPage")} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </main>
    </div>
  );
}

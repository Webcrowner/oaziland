import { getTranslations } from "next-intl/server";
import { listTrainings } from "@/lib/api";
import TrainingCatalog from "@/components/TrainingCatalog";
import TrainingFilters from "@/components/TrainingFilters";
import ManageCoursesLink from "@/components/ManageCoursesLink";
import { TRAINING_CATEGORIES } from "@/lib/trainingCategories";
import { Link } from "@/i18n/navigation";
import EmptyState from "@/components/ui/EmptyState";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Formation & Cours | Oaziland" : "Training & Courses | Oaziland",
    description: locale === "fr"
      ? "Gestion immobilière, droit locatif et préparation aux licences."
      : "Property management, tenant law, and licensing prep.",
  };
}

const PAGE_SIZE = 20;

type SearchParams = { q?: string; category?: string; free?: string; certificate?: string; page?: string };

export default async function TrainingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const t = await getTranslations("TrainingPage");
  const sp = await searchParams;
  const filters = {
    q: sp.q?.trim() ?? "",
    category: (TRAINING_CATEGORIES as readonly string[]).includes(sp.category ?? "") ? sp.category! : "",
    free: sp.free === "true",
    certificate: sp.certificate === "true",
  };
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const hasFilters = Boolean(filters.q || filters.category || filters.free || filters.certificate);

  let data: Awaited<ReturnType<typeof listTrainings>> | null = null;
  try {
    data = await listTrainings({ ...filters, page });
  } catch {
    data = null;
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;
  const query = (targetPage: number) => ({
    ...(filters.q && { q: filters.q }),
    ...(filters.category && { category: filters.category }),
    ...(filters.free && { free: "true" }),
    ...(filters.certificate && { certificate: "true" }),
    ...(targetPage > 1 && { page: String(targetPage) }),
  });

  return (
    <>
      <section className="hero-gradient text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6 px-4 py-12 md:py-14">
          <div className="max-w-2xl">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold leading-tight tracking-tight md:text-4xl">🎓 {t("title")}</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300 md:text-base">{t("subtitle")}</p>
          </div>
          <ManageCoursesLink />
        </div>
      </section>
    <main className="max-w-6xl mx-auto px-4 py-8">
      <TrainingFilters key={JSON.stringify(filters)} initial={filters} />

      {!data ? (
        <EmptyState icon="⚠️" title={t("loadFailed")} />
      ) : data.results.length === 0 ? (
        hasFilters ? (
          <EmptyState icon="🔍" title={t("noResults")} description={t("noResultsHint")} />
        ) : (
          <EmptyState icon="🎓" title={t("noTrainingsYet")} />
        )
      ) : (
        <>
          <p className="mb-4 text-sm font-medium text-slate-500">{t("resultsCount", { count: data.count })}</p>
          <TrainingCatalog programs={data.results} />
          {totalPages > 1 && (
            <nav className="mt-10 flex items-center justify-center gap-4 text-sm" aria-label="Pagination">
              {page > 1 ? (
                <Link href={{ pathname: "/trainings", query: query(page - 1) }} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-[var(--navy)] transition hover:bg-slate-50">
                  {t("previous")}
                </Link>
              ) : (
                <span className="rounded-xl border border-slate-200 px-4 py-2 text-slate-400">{t("previous")}</span>
              )}
              <span className="text-slate-600">{t("pageOf", { page, total: totalPages })}</span>
              {page < totalPages ? (
                <Link href={{ pathname: "/trainings", query: query(page + 1) }} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-[var(--navy)] transition hover:bg-slate-50">
                  {t("next")}
                </Link>
              ) : (
                <span className="rounded-xl border border-slate-200 px-4 py-2 text-slate-400">{t("next")}</span>
              )}
            </nav>
          )}
        </>
      )}
    </main>
    </>
  );
}

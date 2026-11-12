"use client";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { TrainingProgram } from "@/lib/api";
import { trainingTheme } from "@/lib/trainingCategories";
import StarRating from "@/components/StarRating";
import TrainingEnrollActions, { useMyEnrollments } from "@/components/TrainingEnrollActions";

/**
 * A client-side island for enrollment — the training LIST itself is
 * server-rendered (see the page.tsx wrapping this), but enrolling
 * requires a real authenticated POST.
 */
export default function TrainingCatalog({ programs }: { programs: TrainingProgram[] }) {
  const t = useTranslations("TrainingPage");
  const locale = useLocale();
  const { enrollments, loggedIn, reload } = useMyEnrollments();

  function categoryLabel(category: string) {
    return t.has(`categories.${category}`) ? t(`categories.${category}`) : category.replaceAll("_", " ");
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {programs.map((program) => {
        const price = Number(program.price_xaf);
        const theme = trainingTheme(program.category);
        return (
          <article key={program.id} className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:border-amber-300/60 hover:shadow-xl">
            <Link href={`/trainings/${program.id}`} className={`relative flex h-36 items-end justify-between overflow-hidden bg-gradient-to-br p-4 ${theme.gradient}`} aria-label={program.title}>
              {program.cover_image_url ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- uploads from arbitrary storage hosts */}
                  <img src={program.cover_image_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" aria-hidden />
                </>
              ) : (
                <span className="absolute right-4 top-3 text-4xl opacity-90 drop-shadow" aria-hidden>{theme.icon}</span>
              )}
              <span className="relative rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur">
                {categoryLabel(program.category)}
              </span>
              <span className={`relative rounded-full px-2.5 py-1 text-xs font-bold ${price > 0 ? "bg-white text-[var(--navy)]" : "bg-emerald-500 text-white"}`}>
                {price > 0 ? t("priceLabel", { price: price.toLocaleString(locale) }) : t("free")}
              </span>
            </Link>
            <div className="flex flex-1 flex-col p-5">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-bold leading-snug text-slate-900">
                <Link href={`/trainings/${program.id}`} className="hover:text-[var(--navy)] hover:underline">{program.title}</Link>
              </h2>
              {program.provider_name && (
                <p className="mt-1 text-xs text-slate-500">
                  {program.provider_id ? (
                    <Link href={`/trainers/${program.provider_id}`} className="hover:text-[var(--navy)] hover:underline">
                      {t("byProvider", { provider: program.provider_name })}
                    </Link>
                  ) : t("byProvider", { provider: program.provider_name })}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                {program.rating_average !== null ? (
                  <span className="flex items-center gap-1">
                    <span className="font-bold text-slate-900">{program.rating_average.toFixed(1)}</span>
                    <StarRating value={program.rating_average} size="text-xs" />
                    <span className="text-slate-500">({program.rating_count})</span>
                  </span>
                ) : (
                  <span className="text-slate-400">{t("noRatingsYet")}</span>
                )}
                {program.learner_count > 0 && <span>👥 {t("learnersCount", { count: program.learner_count })}</span>}
              </div>
              {program.description && <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600">{program.description}</p>}
              <ul className="my-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
                <li>📅 {program.starts_at ? t("startsOn", { date: formatDate(program.starts_at) }) : t("selfPaced")}</li>
                {program.location && <li>📍 {program.location}</li>}
                {program.lesson_count > 0 && <li>📚 {t("lessonsCount", { count: program.lesson_count })}</li>}
                {program.issues_certification && <li className="font-medium text-amber-700">🏅 {t("issuesCertificate")}</li>}
              </ul>
              <div className="mt-auto">
                <TrainingEnrollActions program={program} enrollment={enrollments.get(program.id)} loggedIn={loggedIn} reload={reload} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
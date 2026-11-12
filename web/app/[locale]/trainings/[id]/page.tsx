import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getTraining, type CourseSyllabusLesson, type TrainingProgramDetail } from "@/lib/api";
import { trainingTheme } from "@/lib/trainingCategories";
import StarRating from "@/components/StarRating";
import CourseEnrollPanel from "@/components/CourseEnrollPanel";
import CourseReviews from "@/components/CourseReviews";

type Params = Promise<{ locale: string; id: string }>;

async function load(id: string): Promise<TrainingProgramDetail | null> {
  try {
    return await getTraining(id);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const program = await load(id);
  if (!program) return { title: "Course | Oaziland" };
  return {
    title: `${program.title} | Oaziland`,
    description: program.description.slice(0, 160),
    openGraph: program.cover_image_url ? { images: [program.cover_image_url] } : undefined,
  };
}

const KIND_ICONS: Record<CourseSyllabusLesson["kind"], string> = { TEXT: "📖", VIDEO: "▶️", PDF: "📄", QUIZ: "❓", ASSIGNMENT: "📝" };

export default async function CourseDetailPage({ params }: { params: Params }) {
  const { id, locale } = await params;
  const program = await load(id);
  if (!program) notFound();
  const t = await getTranslations("CourseDetail");
  const tp = await getTranslations("TrainingPage");
  const tk = await getTranslations("CoursePlayer");

  const price = Number(program.price_xaf);
  const theme = trainingTheme(program.category);
  const lessons = program.syllabus.flatMap((m) => m.lessons);
  const kindCount = (kind: CourseSyllabusLesson["kind"]) => lessons.filter((l) => l.kind === kind).length;
  const category = tp.has(`categories.${program.category}`) ? tp(`categories.${program.category}`) : program.category;
  const includes = [
    { icon: "⏱️", text: t("durationHours", { count: Number(program.duration_hours) }), show: Boolean(program.duration_hours) },
    { icon: "📚", text: tp("lessonsCount", { count: lessons.length }), show: lessons.length > 0 },
    { icon: "▶️", text: t("videos", { count: kindCount("VIDEO") }), show: kindCount("VIDEO") > 0 },
    { icon: "📖", text: t("readings", { count: kindCount("TEXT") + kindCount("PDF") }), show: kindCount("TEXT") + kindCount("PDF") > 0 },
    { icon: "❓", text: t("quizzes", { count: kindCount("QUIZ") }), show: kindCount("QUIZ") > 0 },
    { icon: "📝", text: t("assignments", { count: kindCount("ASSIGNMENT") }), show: kindCount("ASSIGNMENT") > 0 },
    { icon: "🏅", text: tp("issuesCertificate"), show: program.issues_certification },
    {
      icon: "⏳",
      text: t("certificateValidFor", { count: program.certificate_validity_months ?? 0 }),
      show: program.issues_certification && Boolean(program.certificate_validity_months),
    },
    {
      icon: "📅",
      text: program.starts_at
        ? tp("startsOn", { date: new Date(program.starts_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })
        : tp("selfPaced"),
      show: true,
    },
    { icon: "📍", text: program.location, show: Boolean(program.location) },
  ].filter((item) => item.show);

  return (
    <>
      <section className={`relative overflow-hidden bg-gradient-to-br text-white ${theme.gradient}`}>
        {program.cover_image_url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- uploads from arbitrary storage hosts */}
            <img src={program.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-950/80 to-slate-950/40" aria-hidden />
          </>
        )}
        {!program.cover_image_url && <span className="absolute inset-0 bg-slate-950/40" aria-hidden />}
        <div className="relative mx-auto max-w-6xl px-4 py-10 md:py-14 lg:pr-[24rem]">
          <Link href="/trainings" className="text-sm font-medium text-amber-300 hover:underline">← {t("allCourses")}</Link>
          <p className="mt-4 text-xs font-bold uppercase tracking-widest text-amber-200">{category}</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold leading-tight tracking-tight md:text-4xl">{program.title}</h1>
          {program.description && <p className="mt-3 line-clamp-3 max-w-2xl text-sm leading-relaxed text-slate-200 md:text-base">{program.description}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-200">
            {program.rating_average !== null ? (
              <span className="flex items-center gap-1.5">
                <span className="font-bold text-amber-300">{program.rating_average.toFixed(1)}</span>
                <StarRating value={program.rating_average} />
                <a href="#reviews" className="underline">{t("ratingsCount", { count: program.rating_count })}</a>
              </span>
            ) : (
              <span>{t("noRatingsYet")}</span>
            )}
            <span>👥 {tp("learnersCount", { count: program.learner_count })}</span>
            {program.provider_name && (
              <Link href={`/trainers/${program.provider_id}`} className="underline-offset-2 hover:underline">👤 {t("taughtBy", { name: program.provider_name })}</Link>
            )}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-8 lg:grid lg:grid-cols-[1fr_22rem] lg:gap-10">
        <aside className="mb-8 lg:order-2 lg:-mt-48 lg:mb-0">
          <div className="sticky top-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className={`relative h-40 bg-gradient-to-br ${theme.gradient}`}>
              {program.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- uploads from arbitrary storage hosts
                <img src={program.cover_image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-6xl" aria-hidden>{theme.icon}</span>
              )}
            </div>
            <div className="p-5">
              <p className="mb-4 text-3xl font-black text-slate-900">
                {price > 0 ? tp("priceLabel", { price: price.toLocaleString(locale) }) : tp("free")}
              </p>
              <CourseEnrollPanel program={program} />
              <p className="mb-2 mt-6 text-sm font-bold text-slate-900">{t("includes")}</p>
              <ul className="space-y-1.5 text-sm text-slate-600">
                {includes.map((item) => (
                  <li key={item.icon + item.text} className="flex gap-2"><span aria-hidden>{item.icon}</span>{item.text}</li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        <div className="lg:order-1">
          {program.description && (
            <section className="mb-10">
              <h2 className="mb-3 font-[family-name:var(--font-display)] text-2xl font-bold text-slate-900">{t("about")}</h2>
              <p className="whitespace-pre-line leading-relaxed text-slate-700">{program.description}</p>
            </section>
          )}

          <section className="mb-10">
            <h2 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold text-slate-900">{t("syllabus")}</h2>
            {program.syllabus.length === 0 ? (
              <p className="mt-2 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">{t("deliveredByTrainer")}</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-slate-500">{t("syllabusSummary", { modules: program.syllabus.length, lessons: lessons.length })}</p>
                <ol className="space-y-3">
                  {program.syllabus.map((module, index) => (
                    <li key={module.id}>
                      <details className="group rounded-2xl border border-slate-200 bg-white" open={index === 0}>
                        <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--navy)] text-sm font-bold text-white">{index + 1}</span>
                          <span className="flex-1 font-semibold text-slate-900">{module.title}</span>
                          <span className="text-xs text-slate-500">{tp("lessonsCount", { count: module.lessons.length })}</span>
                          <span className="text-slate-400 transition-transform group-open:rotate-90" aria-hidden>›</span>
                        </summary>
                        <ul className="border-t border-slate-100 px-4 py-2">
                          {module.lessons.map((lesson) => (
                            <li key={lesson.id} className="flex items-center gap-3 py-2 text-sm text-slate-700">
                              <span aria-hidden>{KIND_ICONS[lesson.kind]}</span>
                              <span className="flex-1">{lesson.title}</span>
                              <span className="text-xs text-slate-400">{tk(`kind${lesson.kind}`)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>

          <section id="reviews" className="scroll-mt-24">
            <h2 className="mb-4 font-[family-name:var(--font-display)] text-2xl font-bold text-slate-900">{t("reviews")}</h2>
            <CourseReviews programId={program.id} />
          </section>
        </div>
      </main>
    </>
  );
}

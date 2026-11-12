"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getCourseAnalytics, type CourseAnalytics } from "@/lib/api";
import StarRating from "@/components/StarRating";

/** The course's numbers for its staff: enrollments, where learners drop off, which quizzes are hard, earnings. */
export default function CourseAnalyticsPanel({ courseId }: { courseId: string }) {
  const t = useTranslations("CourseAnalytics");
  const tk = useTranslations("CoursePlayer");
  const locale = useLocale();
  const [data, setData] = useState<CourseAnalytics | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getCourseAnalytics(courseId, token).then(setData).catch(() => setFailed(true));
  }, [courseId]);

  if (failed) return <p role="alert" className="text-red-600">{t("loadFailed")}</p>;
  if (!data) return <p className="text-slate-400">…</p>;

  const money = (value: string) => `${Number(value).toLocaleString(locale)} XAF`;
  const tiles = [
    { label: t("learners"), value: data.learners.total, hint: t("awaitingPayment", { count: data.learners.awaiting_payment }) },
    { label: t("inProgress"), value: data.learners.enrolled + data.learners.in_progress },
    { label: t("completed"), value: data.learners.completed, hint: t("completionRate", { percent: data.learners.completion_percent }) },
    { label: t("dropped"), value: data.learners.dropped },
    { label: t("certificates"), value: data.learners.certificates },
  ];
  // The biggest single drop between consecutive lessons is where the course most needs attention.
  const worst = data.lesson_funnel.reduce<(typeof data.lesson_funnel)[number] | null>(
    (max, step) => (step.drop_off_percent > (max?.drop_off_percent ?? 0) ? step : max), null,
  );

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tile.label}</p>
            <p className="mt-1 text-3xl font-black text-slate-900">{tile.value.toLocaleString(locale)}</p>
            {tile.hint && <p className="mt-1 text-xs text-slate-500">{tile.hint}</p>}
          </div>
        ))}
      </section>

      {data.earnings && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
          <h2 className="mb-3 font-bold text-slate-900">💰 {t("earnings")}</h2>
          <dl className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div><dt className="text-slate-500">{t("sales")}</dt><dd className="text-lg font-bold">{data.earnings.sales}</dd></div>
            <div><dt className="text-slate-500">{t("paidByLearners")}</dt><dd className="text-lg font-bold">{money(data.earnings.paid_by_learners_xaf)}</dd></div>
            <div><dt className="text-slate-500">{t("heldInEscrow")}</dt><dd className="text-lg font-bold">{money(data.earnings.held_in_escrow_xaf)}</dd></div>
            <div><dt className="text-slate-500">{t("releasedToTrainer")}</dt><dd className="text-lg font-bold text-emerald-700">{money(data.earnings.released_to_trainer_xaf)}</dd></div>
            <div><dt className="text-slate-500">{t("platformFees")}</dt><dd className="text-lg font-bold">{money(data.earnings.platform_fees_xaf)}</dd></div>
            <div><dt className="text-slate-500">{t("refunded")}</dt><dd className="text-lg font-bold">{money(data.earnings.refunded_xaf)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">{t("earningsHint")}</p>
        </section>
      )}

      <section>
        <h2 className="mb-1 font-bold text-slate-900">{t("funnelTitle")}</h2>
        <p className="mb-4 text-sm text-slate-500">{t("funnelHint")}</p>
        {data.lesson_funnel.length === 0 ? (
          <p className="text-sm text-slate-500">{t("noLessons")}</p>
        ) : (
          <>
            {worst && worst.drop_off_percent >= 20 && (
              <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                ⚠️ {t("worstDropOff", { percent: worst.drop_off_percent, title: worst.title })}
              </p>
            )}
            <ol className="space-y-2">
              {data.lesson_funnel.map((step) => (
                <li key={step.lesson_id} className="grid grid-cols-[2rem_1fr] items-center gap-3 sm:grid-cols-[2rem_16rem_1fr_6rem]">
                  <span className="text-xs font-bold text-slate-400">{step.position}</span>
                  <span className="truncate text-sm text-slate-800">
                    {step.title} <span className="text-xs text-slate-400">· {tk(`kind${step.kind}`)}</span>
                  </span>
                  <span className="col-span-2 h-3 overflow-hidden rounded-full bg-slate-100 sm:col-span-1">
                    <span className="block h-full rounded-full bg-[var(--navy)]" style={{ width: `${step.percent}%` }} />
                  </span>
                  <span className="col-span-2 text-right text-xs text-slate-600 sm:col-span-1">
                    {step.percent}% <span className="text-slate-400">({step.completed})</span>
                    {step.drop_off_percent > 0 && <span className="ml-1 text-red-600">−{step.drop_off_percent}%</span>}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-bold text-slate-900">{t("quizzesTitle")}</h2>
        <p className="mb-4 text-sm text-slate-500">{t("quizzesHint")}</p>
        {data.quizzes.length === 0 ? (
          <p className="text-sm text-slate-500">{t("noQuizzes")}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">{t("quiz")}</th><th className="p-3">{t("takers")}</th><th className="p-3">{t("avgBest")}</th>
                  <th className="p-3">{t("avgAttempts")}</th><th className="p-3">{t("firstTry")}</th><th className="p-3">{t("passRate")}</th>
                </tr>
              </thead>
              <tbody>
                {data.quizzes.map((quiz) => {
                  const hard = quiz.learners > 0 && quiz.first_try_pass_percent < 50;
                  return (
                    <tr key={quiz.lesson_id} className="border-t">
                      <td className="p-3 font-medium">
                        {quiz.title}
                        {hard && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{t("hard")}</span>}
                        <div className="text-xs text-slate-400">{t("passMark", { percent: quiz.pass_mark_percent })}</div>
                      </td>
                      <td className="p-3">{quiz.learners}</td>
                      <td className="p-3">{quiz.average_best_score === null ? "—" : `${quiz.average_best_score}%`}</td>
                      <td className="p-3">{quiz.average_attempts ?? "—"}</td>
                      <td className="p-3">{quiz.learners ? `${quiz.first_try_pass_percent}%` : "—"}</td>
                      <td className="p-3">{quiz.learners ? `${quiz.pass_percent}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-bold text-slate-900">{t("ratingTitle")}</h2>
        {data.rating.average !== null ? (
          <p className="flex items-center gap-2 text-sm text-slate-700">
            <span className="text-2xl font-black">{data.rating.average.toFixed(1)}</span>
            <StarRating value={data.rating.average} />
            <span className="text-slate-500">{t("reviewCount", { count: data.rating.count })}</span>
          </p>
        ) : (
          <p className="text-sm text-slate-500">{t("noRatings")}</p>
        )}
      </section>
    </div>
  );
}

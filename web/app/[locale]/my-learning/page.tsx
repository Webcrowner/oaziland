"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import { getMyEnrollments, type TrainingEnrollmentItem } from "@/lib/api";
import { loginHref } from "@/lib/authRedirect";
import { trainingTheme } from "@/lib/trainingCategories";

type Tab = "active" | "completed";
const ACTIVE = ["PAYMENT_PENDING", "ENROLLED", "IN_PROGRESS"];

/** Every course the learner is taking or has finished, with a way back into each one and their certificates. */
export default function MyLearningPage() {
  const t = useTranslations("MyLearning");
  const tp = useTranslations("TrainingPage");
  const locale = useLocale();
  const [state, setState] = useState<"loading" | "signedOut" | "error" | "ready">("loading");
  const [enrollments, setEnrollments] = useState<TrainingEnrollmentItem[]>([]);
  const [tab, setTab] = useState<Tab>("active");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      void Promise.resolve().then(() => setState("signedOut"));
      return;
    }
    getMyEnrollments(token)
      .then((data) => {
        setEnrollments(data.results);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  const active = enrollments.filter((e) => ACTIVE.includes(e.status));
  const completed = enrollments.filter((e) => e.status === "COMPLETED");
  const shown = tab === "active" ? active : completed;

  return (
    <AccountSidebarLayout activeHref="/my-learning">
      <section className="mb-6 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-6 text-white shadow-xl md:p-8">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold md:text-3xl">🎓 {t("title")}</h1>
        <p className="mt-1 text-sm text-slate-300">{t("subtitle")}</p>
        {state === "ready" && (
          <div className="mt-5 flex flex-wrap gap-6 text-sm">
            <span><span className="text-2xl font-black text-amber-300">{active.length}</span> {t("inProgressCount")}</span>
            <span><span className="text-2xl font-black text-emerald-300">{completed.length}</span> {t("completedCount")}</span>
            <span><span className="text-2xl font-black text-white">{completed.filter((e) => e.certificate_code).length}</span> {t("certificatesCount", { count: completed.filter((e) => e.certificate_code).length })}</span>
          </div>
        )}
      </section>

      {state === "loading" && <p className="text-slate-500">…</p>}
      {state === "error" && <p role="alert" className="text-red-600">{t("loadFailed")}</p>}
      {state === "signedOut" && (
        <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center">
          <p className="mb-4 text-sm font-semibold text-slate-600">{t("signIn")}</p>
          <Link href={loginHref("/my-learning")} className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white">{tp("signInToEnroll")}</Link>
        </div>
      )}

      {state === "ready" && (
        <>
          <div className="mb-5 flex gap-1 border-b border-slate-200" role="tablist">
            {(["active", "completed"] as const).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === key ? "border-[var(--navy)] text-[var(--navy)]" : "border-transparent text-slate-500 hover:text-slate-800"}`}
              >
                {key === "active" ? t("tabActive", { count: active.length }) : t("tabCompleted", { count: completed.length })}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="mb-4 text-slate-600">{tab === "active" ? t("emptyActive") : t("emptyCompleted")}</p>
              <Link href="/trainings" className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white">{t("browse")}</Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {shown.map((enrollment) => {
                const program = enrollment.program_detail;
                if (!program) return null;
                const theme = trainingTheme(program.category);
                const progress = enrollment.progress;
                return (
                  <li key={enrollment.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:flex-row">
                    <Link href={`/trainings/${program.id}`} className={`relative h-32 shrink-0 bg-gradient-to-br sm:h-auto sm:w-48 ${theme.gradient}`} aria-label={program.title}>
                      {program.cover_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- uploads from arbitrary storage hosts
                        <img src={program.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-4xl" aria-hidden>{theme.icon}</span>
                      )}
                    </Link>
                    <div className="flex flex-1 flex-col gap-3 p-5">
                      <div>
                        <Link href={`/trainings/${program.id}`} className="font-[family-name:var(--font-display)] text-lg font-bold text-slate-900 hover:underline">
                          {program.title}
                        </Link>
                        {program.provider_name && <p className="text-xs text-slate-500">{tp("byProvider", { provider: program.provider_name })}</p>}
                      </div>

                      {enrollment.status === "PAYMENT_PENDING" ? (
                        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">📱 {t("awaitingPayment")}</p>
                      ) : enrollment.status === "COMPLETED" ? (
                        <p className="text-sm text-emerald-700">
                          ✓ {t("completedOn", { date: new Date(enrollment.completed_at ?? enrollment.enrolled_at).toLocaleDateString(locale, { dateStyle: "medium" }) })}
                        </p>
                      ) : progress && progress.total > 0 ? (
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-600">{tp("progressLabel", { done: progress.done, total: progress.total, percent: progress.percent })}</p>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
                            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600" style={{ width: `${progress.percent}%` }} />
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-600">{tp("trainerConfirms")}</p>
                      )}

                      <div className="mt-auto flex flex-wrap gap-2">
                        {enrollment.status === "PAYMENT_PENDING" ? (
                          <Link href={`/trainings/${program.id}`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">{t("finishPayment")}</Link>
                        ) : (
                          <Link href={`/trainings/${program.id}/learn`} className="rounded-xl bg-[var(--navy)] px-4 py-2 text-sm font-bold text-white hover:bg-[#25396a]">
                            {enrollment.status === "COMPLETED" ? tp("reviewCourse") : enrollment.status === "IN_PROGRESS" ? tp("continueCourse") : tp("openCourse")} →
                          </Link>
                        )}
                        {enrollment.certificate_code && (
                          <Link href={`/certificates/${enrollment.certificate_code}`} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100">
                            🏅 {tp("viewCertificate")}
                          </Link>
                        )}
                        {enrollment.status === "COMPLETED" && (
                          <Link href={`/trainings/${program.id}#reviews`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            ★ {t("rateCourse")}
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </AccountSidebarLayout>
  );
}

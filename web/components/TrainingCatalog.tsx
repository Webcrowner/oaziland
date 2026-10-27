"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import {
  enrollInTraining, getMyEnrollments, startTraining, dropTraining, completeTraining,
  type TrainingProgram, type TrainingEnrollmentItem,
} from "@/lib/api";

const THEMES: Record<string, { icon: string; gradient: string }> = {
  PROPERTY_MANAGEMENT_BASICS: { icon: "🏢", gradient: "from-[#1b2a4a] to-[#3b5a8f]" },
  TENANT_LAW: { icon: "⚖️", gradient: "from-[#a8502e] to-[#cf7d55]" },
  AGENCY_LICENSING_PREP: { icon: "📜", gradient: "from-[#8a6d14] to-[#d4af37]" },
  HOSPITALITY_OPERATIONS: { icon: "🛎️", gradient: "from-[#0f766e] to-[#2aa79b]" },
};
const themeFor = (category: string) => THEMES[category] ?? { icon: "🎓", gradient: "from-slate-700 to-slate-500" };
const BTN_PRIMARY = "rounded-xl bg-[var(--navy)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#25396a] disabled:opacity-50";
const BTN_GHOST = "rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50";

/**
 * A client-side island for enrollment — the training LIST itself is
 * server-rendered (see the page.tsx wrapping this), but enrolling
 * requires a real authenticated POST.
 */
export default function TrainingCatalog({ programs }: { programs: TrainingProgram[] }) {
  const t = useTranslations("TrainingPage");
  const locale = useLocale();
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<Map<string, TrainingEnrollmentItem>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoggedIn(true);
    getMyEnrollments(token)
      .then((data) => setEnrollments(new Map(data.results.map((e) => [e.program, e]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  // One runner for every enrollment action: tracks which program is busy,
  // reloads the real server state afterwards, and surfaces failures on the
  // card instead of swallowing them.
  async function run(programId: string, action: (token: string) => Promise<unknown>) {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setBusyId(programId);
    setErrorId(null);
    try {
      await action(token);
    } catch {
      setErrorId(programId);
    } finally {
      load();
      setBusyId(null);
    }
  }

  function enroll(programId: string) {
    return run(programId, async (token) => {
      const res = await enrollInTraining(programId, token);
      // 409 = already enrolled elsewhere (e.g. another tab); load() will sync it.
      if (!res.ok && res.status !== 409) throw new Error("enroll failed");
    });
  }

  function categoryLabel(category: string) {
    return t.has(`categories.${category}`) ? t(`categories.${category}`) : category.replaceAll("_", " ");
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {programs.map((program) => {
        const enrollment = enrollments.get(program.id);
        const busy = busyId === program.id;
        const price = Number(program.price_xaf);
        return (
          <article key={program.id} className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-amber-300/60 hover:shadow-xl">
            <div className={`relative flex h-28 items-end justify-between bg-gradient-to-br p-4 ${themeFor(program.category).gradient}`}>
              <span className="absolute right-4 top-3 text-4xl opacity-90 drop-shadow" aria-hidden>{themeFor(program.category).icon}</span>
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur">
                {categoryLabel(program.category)}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${price > 0 ? "bg-white text-[var(--navy)]" : "bg-emerald-500 text-white"}`}>
                {price > 0 ? t("priceLabel", { price: price.toLocaleString(locale) }) : t("free")}
              </span>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-bold leading-snug text-slate-900">{program.title}</h2>
              {program.provider_name && (
                <p className="mt-1 text-xs text-slate-500">{t("byProvider", { provider: program.provider_name })}</p>
              )}
              {program.description && <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600">{program.description}</p>}
              <ul className="my-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
                <li>📅 {program.starts_at ? t("startsOn", { date: formatDate(program.starts_at) }) : t("selfPaced")}</li>
                {program.location && <li>📍 {program.location}</li>}
                {program.lesson_count > 0 && <li>📚 {t("lessonsCount", { count: program.lesson_count })}</li>}
                {program.issues_certification && <li className="font-medium text-amber-700">🏅 {t("issuesCertificate")}</li>}
              </ul>
              {enrollment && enrollment.status !== "DROPPED" && program.lesson_count > 0 && enrollment.progress && (
                <div className="mb-4">
                  <div className="mb-1 flex justify-between text-[11px] font-medium text-slate-600">
                    <span>{t("progressLabel", { done: enrollment.progress.done, total: enrollment.progress.total, percent: enrollment.progress.percent })}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={enrollment.progress.percent} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all" style={{ width: `${enrollment.progress.percent}%` }} />
                  </div>
                </div>
              )}

              {(!enrollment || enrollment.status === "DROPPED") ? (
              <div className="mt-auto flex flex-col gap-2">
                {enrollment && <p className="text-center text-xs text-slate-500">{t("statusDropped")}</p>}
                <button
                  onClick={() => enroll(program.id)}
                  disabled={busy}
                  className={BTN_PRIMARY}
                >
                  {!loggedIn ? t("signInToEnroll") : busy ? t("enrolling") : enrollment ? t("enrollAgain") : t("enroll")}
                </button>
              </div>
            ) : program.lesson_count > 0 && (enrollment.status === "ENROLLED" || enrollment.status === "IN_PROGRESS") ? (
              <div className="mt-auto flex flex-col gap-2">
                <Link href={`/trainings/${program.id}/learn`} className={`${BTN_PRIMARY} text-center`}>
                  {enrollment.status === "IN_PROGRESS" ? t("continueCourse") : t("openCourse")} →
                </Link>
                <button
                  onClick={() => window.confirm(t("dropConfirm")) && run(program.id, (token) => dropTraining(enrollment.id, token))}
                  disabled={busy}
                  className={BTN_GHOST}
                >
                  {t("drop")}
                </button>
              </div>
            ) : enrollment.status === "ENROLLED" ? (
              <div className="mt-auto flex flex-col gap-2">
                <p className="text-center text-xs font-semibold text-emerald-700">✓ {t("statusEnrolled")}</p>
                <div className="flex gap-2">
                  <button onClick={() => run(program.id, (token) => startTraining(enrollment.id, token))} disabled={busy} className={`flex-1 ${BTN_PRIMARY}`}>
                    {t("start")}
                  </button>
                  <button
                    onClick={() => window.confirm(t("dropConfirm")) && run(program.id, (token) => dropTraining(enrollment.id, token))}
                    disabled={busy}
                    className={`flex-1 ${BTN_GHOST}`}
                  >
                    {t("drop")}
                  </button>
                </div>
              </div>
            ) : enrollment.status === "IN_PROGRESS" ? (
              <div className="mt-auto flex flex-col gap-2">
                <p className="text-center text-xs font-semibold text-sky-700">{t("statusInProgress")}</p>
                <button
                  onClick={() => run(program.id, (token) => completeTraining(enrollment.id, token))}
                  disabled={busy}
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {program.issues_certification ? t("completeAndCertificate") : t("markComplete")}
                </button>
                <button
                  onClick={() => window.confirm(t("dropConfirm")) && run(program.id, (token) => dropTraining(enrollment.id, token))}
                  disabled={busy}
                  className={BTN_GHOST}
                >
                  {t("drop")}
                </button>
              </div>
            ) : (
              <div className="mt-auto flex flex-col items-center gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-center">
                <p className="text-sm font-bold text-emerald-800">✓ {t("statusCompleted")}</p>
                {enrollment.certificate_issued_at && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                    🏅 {t("certificateIssued")}
                  </span>
                )}
                {program.lesson_count > 0 && (
                  <Link href={`/trainings/${program.id}/learn`} className="text-xs font-semibold text-[var(--navy)] underline">{t("reviewCourse")}</Link>
                )}
              </div>
            )}
            {errorId === program.id && (
              <p role="alert" className="mt-2 text-center text-xs text-red-600">{t("actionFailed")}</p>
            )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

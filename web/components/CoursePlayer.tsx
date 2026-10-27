"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  getMyEnrollments, getCourseOutline, completeCourseLesson, submitCourseQuiz, submitCourseAssignment, openMySubmission,
  type CourseOutline, type CourseOutlineLesson, type QuizResult, type TrainingEnrollmentItem,
} from "@/lib/api";

import LessonVideo from "@/components/LessonVideo";

export default function CoursePlayer({ programId }: { programId: string }) {
  const t = useTranslations("CoursePlayer");
  const [state, setState] = useState<"loading" | "signin" | "notenrolled" | "error" | "ready">("loading");
  const [enrollment, setEnrollment] = useState<TrainingEnrollmentItem | null>(null);
  const [outline, setOutline] = useState<CourseOutline | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState("");

  const lessons = useMemo(() => outline?.modules.flatMap((m) => m.lessons) ?? [], [outline]);
  const lesson: CourseOutlineLesson | undefined = lessons.find((l) => l.id === lessonId) ?? lessons[0];

  const refresh = useCallback(async (enrollmentId: string, token: string, pickFirstOpen = false) => {
    const data = await getCourseOutline(enrollmentId, token);
    setOutline(data);
    if (pickFirstOpen) {
      const all = data.modules.flatMap((m) => m.lessons);
      setLessonId((all.find((l) => !l.completed) ?? all[0])?.id ?? null);
    }
    return data;
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      void Promise.resolve().then(() => setState("signin"));
      return;
    }
    getMyEnrollments(token)
      .then(async (data) => {
        const mine = data.results.find((e) => e.program === programId && e.status !== "DROPPED");
        if (!mine) return setState("notenrolled");
        setEnrollment(mine);
        await refresh(mine.id, token, true);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [programId, refresh]);

  function select(id: string) {
    setLessonId(id);
    setAnswers({});
    setResult(null);
    setError(false);
    setPdf(null);
    setPdfError("");
  }

  async function submitAssignment() {
    const token = localStorage.getItem("access_token");
    if (!token || !enrollment || !lesson || !pdf) return;
    if (pdf.type !== "application/pdf") return setPdfError(t("pdfOnly"));
    setBusy(true);
    setPdfError("");
    try {
      await submitCourseAssignment(enrollment.id, lesson.id, pdf, token);
      setPdf(null);
      await refresh(enrollment.id, token);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function viewSubmission() {
    const token = localStorage.getItem("access_token");
    if (!token || !enrollment || !lesson) return;
    try {
      await openMySubmission(enrollment.id, lesson.id, token);
    } catch {
      setError(true);
    }
  }

  async function markComplete(advance = true) {
    const token = localStorage.getItem("access_token");
    if (!token || !enrollment || !lesson) return;
    setBusy(true);
    setError(false);
    try {
      await completeCourseLesson(enrollment.id, lesson.id, token);
      const data = await refresh(enrollment.id, token);
      const all = data.modules.flatMap((m) => m.lessons);
      const next = all[all.findIndex((l) => l.id === lesson.id) + 1];
      if (advance && next) select(next.id);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  // Fired when the learner has watched the whole video; stays on the lesson so they see it was recorded.
  function videoFinished() {
    if (lesson && !lesson.completed && !busy && !finished) void markComplete(false);
  }

  const nextLesson = lesson ? lessons[lessons.findIndex((l) => l.id === lesson.id) + 1] : undefined;

  async function submitQuiz() {
    const token = localStorage.getItem("access_token");
    if (!token || !enrollment || !lesson) return;
    setBusy(true);
    setError(false);
    try {
      setResult(await submitCourseQuiz(enrollment.id, lesson.id, answers, token));
      await refresh(enrollment.id, token);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function toggle(questionId: string, choiceId: string, multiple: boolean) {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      if (!multiple) return { ...prev, [questionId]: [choiceId] };
      return { ...prev, [questionId]: current.includes(choiceId) ? current.filter((c) => c !== choiceId) : [...current, choiceId] };
    });
  }

  if (state === "loading") return <p className="py-16 text-center text-slate-500">{t("loading")}</p>;
  if (state === "signin") return <p className="py-16 text-center text-slate-700">{t("signIn")}</p>;
  if (state === "error") return <p role="alert" className="py-16 text-center text-red-600">{t("loadFailed")}</p>;
  if (state === "notenrolled") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="mb-4 text-slate-700">{t("notEnrolled")}</p>
        <Link href="/trainings" className="inline-block rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#25396a]">{t("goToCatalog")}</Link>
      </div>
    );
  }
  if (!outline) return null;

  const finished = outline.status === "COMPLETED";
  const quizReady = lesson?.questions?.length && lesson.questions.every((q) => (answers[q.id] ?? []).length > 0);
  const videoLink = lesson?.kind === "VIDEO" ? lesson.video_file_url || lesson.video_url : "";

  return (
    <div>
      <section className="hero-gradient mb-6 overflow-hidden rounded-2xl p-6 text-white md:p-8">
        <Link href="/trainings" className="text-sm font-medium text-amber-300 hover:underline">{t("back")}</Link>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight md:text-3xl">{outline.program.title}</h1>
        <div className="mt-5 max-w-xl">
          <div className="mb-1.5 flex items-baseline justify-between text-xs text-slate-300">
            <span>{t("progress", { done: outline.progress.done, total: outline.progress.total })}</span>
            <span className="text-base font-bold text-white">{outline.progress.percent}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={outline.progress.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500" style={{ width: `${outline.progress.percent}%` }} />
          </div>
        </div>
      </section>

      {finished && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <p className="font-bold">{t("courseCompleted")}</p>
          {outline.certificate_issued_at && <p className="mt-1 text-sm">🏅 {t("certificateIssued")}</p>}
        </div>
      )}

      {lessons.length === 0 ? (
        <p className="text-slate-600">{t("noLessons")}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[19rem_1fr]">
          <nav className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:self-start md:overflow-y-auto">
            {outline.modules.map((m, mi) => (
              <div key={m.id} className="mb-4 last:mb-0">
                <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--navy)] text-[10px] text-white">{mi + 1}</span>
                  {m.title}
                </p>
                <ul className="space-y-0.5">
                  {m.lessons.map((l) => (
                    <li key={l.id}>
                      <button
                        onClick={() => select(l.id)}
                        aria-current={l.id === lesson?.id}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${l.id === lesson?.id ? "bg-[var(--navy)]/[0.07] font-semibold text-[var(--navy)] ring-1 ring-[var(--navy)]/15" : "text-slate-700 hover:bg-slate-50"}`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${l.completed ? "bg-emerald-500 text-white" : "border border-slate-300 text-transparent"}`}
                          aria-hidden
                        >
                          ✓
                        </span>
                        <span className="flex-1">{l.title}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{t(`kind${l.kind}`)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          {lesson && (
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">{t(`kind${lesson.kind}`)}</p>
              <h2 className="mb-5 mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-slate-900">{lesson.title}</h2>

              {lesson.kind === "TEXT" && <div className="whitespace-pre-wrap text-base leading-relaxed text-slate-800">{lesson.content_text}</div>}

              {lesson.kind === "VIDEO" && (
                <>
                  <div className="overflow-hidden rounded-xl shadow-lg">
                    <LessonVideo title={lesson.title} fileUrl={lesson.video_file_url} url={lesson.video_url} completed={lesson.completed} onEnded={videoFinished} />
                  </div>
                  {videoLink && (
                    <p className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      🔗 {t("videoSource")}: <a href={videoLink} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--navy)] underline">{videoLink}</a>
                    </p>
                  )}
                  {lesson.content_text && <p className="mt-4 whitespace-pre-wrap leading-relaxed text-slate-700">{lesson.content_text}</p>}
                </>
              )}

              {lesson.kind === "PDF" && (
                <>
                  {lesson.content_text && <p className="mb-4 whitespace-pre-wrap leading-relaxed text-slate-700">{lesson.content_text}</p>}
                  <iframe src={lesson.pdf_url} title={lesson.title} className="h-[34rem] w-full rounded-xl border border-slate-200" />
                  <a href={lesson.pdf_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-[var(--navy)] underline">{t("openPdf")}</a>
                </>
              )}

              {lesson.kind === "QUIZ" && (
                <div>
                  <p className="mb-5 inline-block rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                    {t("passMark", { mark: lesson.pass_mark_percent ?? 0 })}
                    {lesson.best_score_percent != null && ` · ${t("bestScore", { score: lesson.best_score_percent })}`}
                  </p>
                  {result && (
                    <div role="status" className={`mb-5 rounded-xl border p-4 text-sm ${result.passed ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                      <p className="text-lg font-bold">{t("score", { score: result.score_percent })}</p>
                      <p>{result.passed ? t("passed") : t("failed")}</p>
                    </div>
                  )}
                  <ol className="space-y-6">
                    {(lesson.questions ?? []).map((q, index) => {
                      const graded = result?.results.find((r) => r.question === q.id);
                      return (
                        <li key={q.id} className="rounded-xl border border-slate-200 p-4">
                          <fieldset disabled={!!result}>
                            <legend className="mb-1 font-semibold text-slate-900">{index + 1}. {q.text}</legend>
                            <p className="mb-3 text-xs text-slate-500">{q.multiple ? t("chooseAll") : t("chooseOne")}</p>
                            {q.choices.map((c) => {
                              const checked = (answers[q.id] ?? []).includes(c.id);
                              const isRight = graded?.correct_choices.includes(c.id);
                              return (
                                <label key={c.id} className={`mb-2 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${graded ? (isRight ? "border-emerald-300 bg-emerald-50" : checked ? "border-red-300 bg-red-50" : "border-slate-200") : checked ? "border-[var(--navy)] bg-[var(--navy)]/[0.05]" : "border-slate-200 hover:bg-slate-50"}`}>
                                  <input type={q.multiple ? "checkbox" : "radio"} name={q.id} checked={checked} onChange={() => toggle(q.id, c.id, q.multiple)} className="h-4 w-4 accent-[var(--navy)]" />
                                  {c.text}
                                </label>
                              );
                            })}
                          </fieldset>
                          {graded && (
                            <p className={`mt-2 text-sm ${graded.correct ? "text-emerald-700" : "text-red-600"}`}>
                              {graded.correct ? `✓ ${t("correct")}` : `✗ ${t("incorrect")}`}
                              {graded.explanation && <span className="text-slate-700"> — {graded.explanation}</span>}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="mt-6 flex items-center gap-3">
                    {result ? (
                      !result.passed && (
                        <button onClick={() => { setResult(null); setAnswers({}); }} className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#25396a]">
                          {t("tryAgain")}
                        </button>
                      )
                    ) : (
                      <button onClick={submitQuiz} disabled={busy || !quizReady} className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#25396a] disabled:opacity-50">
                        {t("submitQuiz")}
                      </button>
                    )}
                    {!result && !quizReady && <span className="text-xs text-slate-500">{t("answerAll")}</span>}
                  </div>
                </div>
              )}

              {lesson.kind === "ASSIGNMENT" && (
                <div>
                  {lesson.content_text && <p className="mb-4 whitespace-pre-wrap leading-relaxed text-slate-800">{lesson.content_text}</p>}
                  <p className="mb-4 text-sm text-slate-600">{t("assignmentHint")}</p>
                  {lesson.submission && (
                    <div
                      role="status"
                      className={`mb-4 rounded-xl border p-4 text-sm ${lesson.submission.status === "APPROVED" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : lesson.submission.status === "CHANGES_REQUESTED" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900"}`}
                    >
                      <p className="font-semibold">{t(`submission${lesson.submission.status}`)}</p>
                      {lesson.submission.feedback && (
                        <p className="mt-1"><span className="font-medium">{t("reviewerFeedback")}:</span> {lesson.submission.feedback}</p>
                      )}
                      <button onClick={viewSubmission} className="mt-2 font-medium underline">{t("viewMySubmission")}</button>
                    </div>
                  )}
                  {lesson.submission?.status !== "APPROVED" && !finished && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
                      <input type="file" accept="application/pdf" aria-label={t("choosePdf")} onChange={(e) => { setPdf(e.target.files?.[0] ?? null); setPdfError(""); }} className="text-sm" />
                      <button onClick={submitAssignment} disabled={busy || !pdf} className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#25396a] disabled:opacity-50">
                        {busy ? t("submitting") : lesson.submission ? t("resubmitPdf") : t("submitPdf")}
                      </button>
                    </div>
                  )}
                  {pdfError && <p role="alert" className="mt-2 text-sm text-red-600">{pdfError}</p>}
                </div>
              )}

              {lesson.kind !== "QUIZ" && lesson.kind !== "ASSIGNMENT" && (
                <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-6">
                  {lesson.completed ? (
                    <>
                      <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">✓ {t("lessonDone")}</p>
                      {nextLesson && (
                        <button onClick={() => select(nextLesson.id)} className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#25396a]">
                          {t("nextLesson")}
                        </button>
                      )}
                    </>
                  ) : (
                    !finished && (
                      <button onClick={() => markComplete()} disabled={busy} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                        {t("markCompleteNext")}
                      </button>
                    )
                  )}
                </div>
              )}
              {error && <p role="alert" className="mt-3 text-sm text-red-600">{t("actionFailed")}</p>}
            </article>
          )}
        </div>
      )}
    </div>
  );
}

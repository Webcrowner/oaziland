"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  getManagedCourse, updateManagedCourse, deleteManagedCourse, createCourseModule, updateCourseModule, deleteCourseModule,
  createCourseLesson, updateCourseLesson, deleteCourseLesson, createCourseQuestion, updateCourseQuestion, deleteCourseQuestion,
  listCourseStaff, assignCourseStaff, removeCourseStaff, listCourseLearners,
  listCourseSubmissions, openCourseSubmission, reviewCourseSubmission,
  type ManageCourse, type ManageLesson, type ManageQuestion, type ManageChoice, type LessonKind,
  type CourseStaffMember, type CourseLearnerRow, type LessonInput, type CourseSubmissionRow,
} from "@/lib/api";
import { TRAINING_CATEGORIES } from "@/lib/trainingCategories";

const KINDS: LessonKind[] = ["TEXT", "VIDEO", "PDF", "QUIZ", "ASSIGNMENT"];
type Tab = "content" | "settings" | "team" | "learners" | "submissions";

function token() {
  return typeof window === "undefined" ? null : localStorage.getItem("access_token");
}

function SubmissionCard({ row, courseId, onDone }: { row: CourseSubmissionRow; courseId: string; onDone: () => void }) {
  const t = useTranslations("CourseManage");
  const [feedback, setFeedback] = useState(row.feedback);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "APPROVED" | "CHANGES_REQUESTED") {
    const tk = token();
    if (!tk) return;
    setBusy(true);
    setError("");
    try {
      await reviewCourseSubmission(courseId, row.id, decision, feedback, tk);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  const colour = row.status === "APPROVED" ? "bg-emerald-100 text-emerald-800" : row.status === "CHANGES_REQUESTED" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800";
  return (
    <li className="rounded-lg border bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{row.student_name || row.username}</span>
        <span className="text-gray-500">— {row.lesson_title}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${colour}`}>{t(`submission_${row.status}`)}</span>
        <span className="ml-auto text-xs text-gray-500">{t("submittedOn", { date: new Date(row.submitted_at).toLocaleString() })}</span>
      </div>
      {row.reviewed_by && <p className="mt-1 text-xs text-gray-500">{t("reviewedBy", { name: row.reviewed_by })}</p>}
      <button
        onClick={() => { const tk = token(); if (tk) openCourseSubmission(courseId, row.id, tk).catch(() => setError(t("actionFailed"))); }}
        className="mt-2 text-[var(--navy)] underline"
      >
        {t("viewPdf")}
      </button>
      {row.status !== "APPROVED" && (
        <div className="mt-2 grid gap-2">
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t("feedbackPlaceholder")} aria-label={t("feedbackPlaceholder")} rows={2} className="rounded border px-3 py-2" />
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => decide("APPROVED")} className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">{t("approve")}</button>
            <button disabled={busy} onClick={() => decide("CHANGES_REQUESTED")} className="rounded border px-3 py-1.5 font-semibold disabled:opacity-50">{t("requestChanges")}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
    </li>
  );
}

function LessonForm({ initial, onSave, onCancel }: { initial?: ManageLesson; onSave: (input: LessonInput) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations("CourseManage");
  const [f, setF] = useState({
    title: initial?.title ?? "", kind: (initial?.kind ?? "TEXT") as LessonKind, content_text: initial?.content_text ?? "",
    video_url: initial?.video_url ?? "", pass_mark_percent: initial?.pass_mark_percent ?? 70,
  });
  const [pdf, setPdf] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [removeVideo, setRemoveVideo] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({
        ...f,
        ...(pdf ? { pdf_file: pdf } : {}),
        ...(video ? { video_file: video } : removeVideo ? { remove_video_file: true } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded border bg-gray-50 p-3">
      <input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t("lessonTitle")} aria-label={t("lessonTitle")} className="rounded border px-3 py-2 text-sm" />
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LessonKind })} aria-label={t("lessonKind")} className="rounded border px-3 py-2 text-sm">
        {KINDS.map((k) => <option key={k} value={k}>{t(`kind${k}`)}</option>)}
      </select>
      {f.kind === "VIDEO" && (
        <div className="grid gap-2 rounded border bg-white p-2">
          <input type="url" value={f.video_url} onChange={(e) => setF({ ...f, video_url: e.target.value })} placeholder={t("videoUrl")} aria-label={t("videoUrl")} className="rounded border px-3 py-2 text-sm" />
          <p className="text-center text-xs text-gray-500">{t("videoOr")}</p>
          <label className="text-sm">
            {t("videoUpload")}
            <input type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime" onChange={(e) => { setVideo(e.target.files?.[0] ?? null); setRemoveVideo(false); }} className="mt-1 block text-sm" />
          </label>
          {initial?.video_file_url && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <a href={initial.video_file_url} target="_blank" rel="noopener noreferrer" className="text-[var(--navy)] underline">{t("currentVideo")}</a>
              <label className="flex items-center gap-1 text-red-600">
                <input type="checkbox" checked={removeVideo} onChange={(e) => setRemoveVideo(e.target.checked)} disabled={!!video} />
                {t("removeVideo")}
              </label>
            </div>
          )}
        </div>
      )}
      {f.kind === "PDF" && (
        <label className="text-sm">
          {t("pdfFile")}
          <input type="file" accept="application/pdf" required={!initial?.pdf_url} onChange={(e) => setPdf(e.target.files?.[0] ?? null)} className="mt-1 block text-sm" />
          {initial?.pdf_url && <a href={initial.pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--navy)] underline">{t("currentPdf")}</a>}
        </label>
      )}
      {f.kind !== "QUIZ" && <textarea value={f.content_text} onChange={(e) => setF({ ...f, content_text: e.target.value })} placeholder={t("contentText")} aria-label={t("contentText")} rows={f.kind === "TEXT" ? 6 : 2} className="rounded border px-3 py-2 text-sm" />}
      {f.kind === "QUIZ" && (
        <label className="text-sm">{t("passMark")}
          <input type="number" min={1} max={100} value={f.pass_mark_percent} onChange={(e) => setF({ ...f, pass_mark_percent: Number(e.target.value) })} className="ml-2 w-20 rounded border px-2 py-1" />
        </label>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="rounded bg-[var(--navy)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{t("save")}</button>
        <button type="button" onClick={onCancel} className="rounded border px-3 py-1.5 text-sm">{t("cancel")}</button>
      </div>
    </form>
  );
}

function QuestionForm({ initial, onSave, onCancel }: { initial?: ManageQuestion; onSave: (q: { text: string; explanation: string; choices: ManageChoice[] }) => Promise<void>; onCancel: () => void }) {
  const t = useTranslations("CourseManage");
  const [text, setText] = useState(initial?.text ?? "");
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [choices, setChoices] = useState<ManageChoice[]>(initial?.choices.map(({ text, is_correct }) => ({ text, is_correct })) ?? [{ text: "", is_correct: true }, { text: "", is_correct: false }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setChoice = (i: number, patch: Partial<ManageChoice>) => setChoices(choices.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({ text, explanation, choices });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded border bg-white p-3">
      <textarea required value={text} onChange={(e) => setText(e.target.value)} placeholder={t("questionText")} aria-label={t("questionText")} rows={2} className="rounded border px-3 py-2 text-sm" />
      <p className="text-xs text-gray-500">{t("quizHint")}</p>
      {choices.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="checkbox" checked={c.is_correct} onChange={(e) => setChoice(i, { is_correct: e.target.checked })} aria-label={t("isCorrect")} title={t("isCorrect")} />
          <input required value={c.text} onChange={(e) => setChoice(i, { text: e.target.value })} placeholder={`${t("choiceText")} ${i + 1}`} aria-label={`${t("choiceText")} ${i + 1}`} className="flex-1 rounded border px-3 py-1.5 text-sm" />
          {choices.length > 2 && <button type="button" onClick={() => setChoices(choices.filter((_, j) => j !== i))} aria-label={t("removeChoice")} className="px-2 text-gray-500">✕</button>}
        </div>
      ))}
      <button type="button" onClick={() => setChoices([...choices, { text: "", is_correct: false }])} className="self-start text-sm text-[var(--navy)] underline">+ {t("addChoice")}</button>
      <input value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder={t("explanation")} aria-label={t("explanation")} className="rounded border px-3 py-2 text-sm" />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="rounded bg-[var(--navy)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{t("save")}</button>
        <button type="button" onClick={onCancel} className="rounded border px-3 py-1.5 text-sm">{t("cancel")}</button>
      </div>
    </form>
  );
}

export default function CourseEditor({ courseId }: { courseId: string }) {
  const t = useTranslations("CourseManage");
  const tc = useTranslations("TrainingPage");
  const router = useRouter();
  const [course, setCourse] = useState<ManageCourse | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("content");
  const [staff, setStaff] = useState<CourseStaffMember[]>([]);
  const [learners, setLearners] = useState<CourseLearnerRow[]>([]);
  const [submissions, setSubmissions] = useState<CourseSubmissionRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // "lesson:<id>" | "newlesson:<moduleId>" | "q:<id>" | "newq:<lessonId>"
  const [newModule, setNewModule] = useState("");
  const [settings, setSettings] = useState({ title: "", description: "", category: "OTHER", price: "", cert: false, published: false });
  const [notice, setNotice] = useState("");
  const [assign, setAssign] = useState({ identifier: "", role: "LECTURER" as "LECTURER" | "SUPERVISOR" });

  const canEdit = course?.my_role === "ADMIN" || course?.my_role === "LECTURER";
  const isAdmin = course?.my_role === "ADMIN";

  const reload = useCallback(async () => {
    const tk = token();
    if (!tk) return setFailed(true);
    try {
      const c = await getManagedCourse(courseId, tk);
      setCourse(c);
      if (c.my_role === "SUPERVISOR") setTab((current) => (current === "content" ? "learners" : current));
      setSettings({ title: c.title, description: c.description, category: c.category, price: c.price_xaf ? String(Number(c.price_xaf)) : "", cert: c.issues_certification, published: c.is_published });
    } catch {
      setFailed(true);
    }
  }, [courseId]);

  useEffect(() => { void Promise.resolve().then(reload); }, [reload]);

  useEffect(() => {
    const tk = token();
    if (!tk || !course) return;
    if (tab === "team") listCourseStaff(courseId, tk).then(setStaff).catch(() => {});
    if (tab === "learners") listCourseLearners(courseId, tk).then(setLearners).catch(() => {});
    if (tab === "submissions") listCourseSubmissions(courseId, tk).then(setSubmissions).catch(() => {});
  }, [tab, courseId, course?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Runs a mutation, reloads, and reports failures instead of swallowing them.
  async function act(fn: (tk: string) => Promise<unknown>, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const tk = token();
    if (!tk) return;
    setNotice("");
    try {
      await fn(tk);
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  if (failed) return <p role="alert" className="text-red-600">{t("actionFailed")}</p>;
  if (!course) return <p className="text-gray-500">…</p>;

  const tabs: Tab[] = canEdit ? ["content", "settings", "team", "learners", "submissions"] : ["learners", "submissions", "content", "team"];

  return (
    <div className="course-editor">
      <section className="hero-gradient mb-6 rounded-2xl p-6 text-white md:p-8">
        <Link href="/trainings/manage" className="text-sm font-medium text-amber-300 hover:underline">← {t("title")}</Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight md:text-3xl">{course.title}</h1>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide">{course.my_role ? t(`role_${course.my_role}`) : ""}</span>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${course.is_published ? "bg-emerald-500/90 text-white" : "bg-amber-400 text-amber-950"}`}>{course.is_published ? t("live") : t("draft")}</span>
          <Link href={`/trainings/${course.id}/learn`} className="ml-auto rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold backdrop-blur transition hover:bg-white/20">👁 {t("preview")}</Link>
        </div>
      </section>
      {!canEdit && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t("readOnly")}</p>}
      {notice && <p role="alert" className="mb-3 text-sm text-red-600">{notice}</p>}

      <div className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200">
        {tabs.map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap px-4 py-2.5 text-sm font-semibold transition ${tab === k ? "border-b-2 border-[var(--navy)] text-[var(--navy)]" : "border-b-2 border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t(`tab${k[0].toUpperCase()}${k.slice(1)}`)}
          </button>
        ))}
      </div>

      {tab === "content" && (
        <div className="space-y-5">
          {course.modules.length === 0 && <p className="text-slate-600">{t("noModules")}</p>}
          {course.modules.map((m) => (
            <section key={m.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                {canEdit ? (
                  <input defaultValue={m.title} aria-label={t("moduleTitle")} onBlur={(e) => e.target.value.trim() && e.target.value !== m.title && act((tk) => updateCourseModule(m.id, { title: e.target.value.trim() }, tk))} className="flex-1 rounded border px-2 py-1 font-semibold" />
                ) : <h2 className="flex-1 font-semibold">{m.title}</h2>}
                {canEdit && <button onClick={() => act((tk) => deleteCourseModule(m.id, tk), t("deleteConfirm"))} className="text-sm text-red-600">{t("delete")}</button>}
              </div>
              {m.lessons.length === 0 && <p className="mb-2 text-sm text-gray-500">{t("noLessons")}</p>}
              <ul className="space-y-2">
                {m.lessons.map((l) => (
                  <li key={l.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                    {editing === `lesson:${l.id}` ? (
                      <LessonForm initial={l} onCancel={() => setEditing(null)} onSave={async (input) => { const tk = token(); if (!tk) return; await updateCourseLesson(l.id, input, tk); setEditing(null); await reload(); }} />
                    ) : (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase">{t(`kind${l.kind}`)}</span>
                        <span className="flex-1">{l.title}</span>
                        {l.kind === "PDF" && l.pdf_url && <a href={l.pdf_url} target="_blank" rel="noopener noreferrer" className="text-[var(--navy)] underline">PDF</a>}
                        {l.kind === "VIDEO" && (l.video_file_url || l.video_url) && <a href={l.video_file_url || l.video_url} target="_blank" rel="noopener noreferrer" className="text-[var(--navy)] underline">{t("watchVideo")}</a>}
                        {canEdit && <>
                          <button onClick={() => setEditing(`lesson:${l.id}`)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-[var(--navy)] hover:bg-slate-50">{t("edit")}</button>
                          <button onClick={() => act((tk) => deleteCourseLesson(l.id, tk), t("deleteConfirm"))} className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">{t("delete")}</button>
                        </>}
                      </div>
                    )}
                    {l.kind === "QUIZ" && (
                      <div className="mt-2 space-y-2 border-l-2 pl-3">
                        {l.questions.length === 0 && <p className="text-xs text-gray-500">{t("noQuestions")}</p>}
                        {l.questions.map((q, i) => editing === `q:${q.id}` ? (
                          <QuestionForm key={q.id} initial={q} onCancel={() => setEditing(null)} onSave={async (input) => { const tk = token(); if (!tk) return; await updateCourseQuestion(q.id, input, tk); setEditing(null); await reload(); }} />
                        ) : (
                          <div key={q.id} className="text-sm">
                            <div className="flex items-start gap-2">
                              <p className="flex-1 font-medium">{i + 1}. {q.text}</p>
                              {canEdit && <>
                                <button onClick={() => setEditing(`q:${q.id}`)} className="text-[var(--navy)]">{t("edit")}</button>
                                <button onClick={() => act((tk) => deleteCourseQuestion(q.id, tk), t("deleteConfirm"))} className="text-red-600">{t("delete")}</button>
                              </>}
                            </div>
                            <ul className="ml-4 text-xs text-gray-700">
                              {q.choices.map((c, j) => <li key={j}>{c.is_correct ? "✓" : "○"} {c.text}</li>)}
                            </ul>
                          </div>
                        ))}
                        {canEdit && (editing === `newq:${l.id}` ? (
                          <QuestionForm onCancel={() => setEditing(null)} onSave={async (input) => { const tk = token(); if (!tk) return; await createCourseQuestion({ ...input, lesson: l.id }, tk); setEditing(null); await reload(); }} />
                        ) : (
                          <button onClick={() => setEditing(`newq:${l.id}`)} className="text-sm text-[var(--navy)] underline">+ {t("addQuestion")}</button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && (editing === `newlesson:${m.id}` ? (
                <div className="mt-3"><LessonForm onCancel={() => setEditing(null)} onSave={async (input) => { const tk = token(); if (!tk) return; await createCourseLesson({ ...input, module: m.id }, tk); setEditing(null); await reload(); }} /></div>
              ) : (
                <button onClick={() => setEditing(`newlesson:${m.id}`)} className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm font-semibold text-[var(--navy)] transition hover:border-[var(--navy)] hover:bg-slate-50">+ {t("addLesson")}</button>
              ))}
            </section>
          ))}
          {canEdit && (
            <form onSubmit={(e) => { e.preventDefault(); if (newModule.trim()) act((tk) => createCourseModule(course.id, newModule.trim(), tk)).then(() => setNewModule("")); }} className="flex gap-2">
              <input value={newModule} onChange={(e) => setNewModule(e.target.value)} placeholder={t("moduleTitle")} aria-label={t("moduleTitle")} className="flex-1 rounded border px-3 py-2 text-sm" />
              <button className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#25396a]">{t("addModule")}</button>
            </form>
          )}
        </div>
      )}

      {tab === "settings" && canEdit && (
        <form
          onSubmit={(e) => { e.preventDefault(); act((tk) => updateManagedCourse(course.id, { title: settings.title, description: settings.description, category: settings.category, price_xaf: settings.price.trim() ? settings.price.trim() : null, issues_certification: settings.cert, is_published: settings.published }, tk)).then(() => setNotice("")); }}
          className="grid max-w-xl gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <input required value={settings.title} onChange={(e) => setSettings({ ...settings, title: e.target.value })} aria-label={t("courseTitle")} className="rounded border px-3 py-2 text-sm" />
          <textarea value={settings.description} onChange={(e) => setSettings({ ...settings, description: e.target.value })} aria-label={t("description")} rows={4} className="rounded border px-3 py-2 text-sm" />
          <select value={settings.category} onChange={(e) => setSettings({ ...settings, category: e.target.value })} aria-label={t("category")} className="rounded border px-3 py-2 text-sm">
            {TRAINING_CATEGORIES.map((c) => <option key={c} value={c}>{tc(`categories.${c}`)}</option>)}
          </select>
          <input type="number" min="0" value={settings.price} onChange={(e) => setSettings({ ...settings, price: e.target.value })} placeholder={t("price")} aria-label={t("price")} className="rounded border px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.cert} onChange={(e) => setSettings({ ...settings, cert: e.target.checked })} />{t("issuesCertificate")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.published} onChange={(e) => setSettings({ ...settings, published: e.target.checked })} />{t("published")}</label>
          <div className="flex items-center gap-3">
            <button className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#25396a]">{t("save")}</button>
            {isAdmin && <button type="button" onClick={() => act((tk) => deleteManagedCourse(course.id, tk), t("deleteCourseConfirm")).then(() => router.push("/trainings/manage"))} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50">{t("delete")}</button>}
          </div>
        </form>
      )}

      {tab === "team" && (
        <div className="max-w-xl">
          <p className="mb-3 text-sm text-gray-600">{t("teamHint")}</p>
          <ul className="mb-4 space-y-2">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded border bg-white p-2 text-sm">
                <span className="flex-1">{s.user_name || s.username} <span className="text-gray-500">({s.phone})</span></span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold">{t(`role_${s.role}`)}</span>
                {isAdmin && <button onClick={() => act(async (tk) => { await removeCourseStaff(course.id, s.id, tk); setStaff(await listCourseStaff(course.id, tk)); })} className="text-red-600">{t("remove")}</button>}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <form onSubmit={(e) => { e.preventDefault(); act(async (tk) => { await assignCourseStaff(course.id, assign.identifier, assign.role, tk); setAssign({ ...assign, identifier: "" }); setStaff(await listCourseStaff(course.id, tk)); }); }} className="flex flex-wrap gap-2">
              <input required value={assign.identifier} onChange={(e) => setAssign({ ...assign, identifier: e.target.value })} placeholder={t("identifier")} aria-label={t("identifier")} className="min-w-0 flex-1 rounded border px-3 py-2 text-sm" />
              <select value={assign.role} onChange={(e) => setAssign({ ...assign, role: e.target.value as "LECTURER" | "SUPERVISOR" })} aria-label="Role" className="rounded border px-3 py-2 text-sm">
                <option value="LECTURER">{t("role_LECTURER")}</option>
                <option value="SUPERVISOR">{t("role_SUPERVISOR")}</option>
              </select>
              <button className="rounded bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white">{t("assign")}</button>
            </form>
          )}
        </div>
      )}

      {tab === "submissions" && (
        submissions.length === 0 ? <p className="text-gray-600">{t("noSubmissions")}</p> : (
          <ul className="space-y-3">
            {submissions.map((row) => (
              <SubmissionCard
                key={`${row.id}:${row.status}:${row.submitted_at}`}
                row={row}
                courseId={course.id}
                onDone={() => { const tk = token(); if (tk) listCourseSubmissions(course.id, tk).then(setSubmissions).catch(() => {}); }}
              />
            ))}
          </ul>
        )
      )}

      {tab === "learners" && (
        learners.length === 0 ? <p className="text-gray-600">{t("noLearners")}</p> : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr><th className="p-2">{t("colLearner")}</th><th className="p-2">{t("colStatus")}</th><th className="p-2">{t("colProgress")}</th><th className="p-2">{t("colQuizzes")}</th><th className="p-2">{t("colCertificate")}</th></tr>
              </thead>
              <tbody>
                {learners.map((r) => (
                  <tr key={r.enrollment} className="border-t align-top">
                    <td className="p-2">{r.student_name || r.username}<div className="text-xs text-gray-500">{r.phone}</div></td>
                    <td className="p-2">{t(`status_${r.status}`)}</td>
                    <td className="p-2">{r.lessons_done}/{r.lessons_total} ({r.progress_percent}%)</td>
                    <td className="p-2">{r.quizzes.length === 0 ? "—" : r.quizzes.map((q) => <div key={q.lesson}>{q.lesson_title}: {q.best_score_percent}% {q.passed ? "✓" : "✗"} <span className="text-xs text-gray-500">({t("attempts", { count: q.attempts })})</span></div>)}</td>
                    <td className="p-2">{r.certificate_issued_at ? t("yes") : t("no")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  deleteDiscussionPost, editDiscussionPost, getDiscussion, listDiscussions, replyToDiscussion, startDiscussion,
  type DiscussionPost, type DiscussionThread, type DiscussionThreadSummary,
} from "@/lib/api";

type Lessonish = { id: string; title: string };

function token() {
  return localStorage.getItem("access_token") ?? "";
}

/** The course's Q&A forum inside the course player: browse/search threads, ask a question, reply, edit, delete. */
export default function CourseDiscussions({ programId, lessons, currentLesson }: { programId: string; lessons: Lessonish[]; currentLesson?: Lessonish }) {
  const t = useTranslations("CourseDiscussions");
  const locale = useLocale();
  const [threads, setThreads] = useState<DiscussionThreadSummary[] | null>(null);
  const [failed, setFailed] = useState("");
  const [query, setQuery] = useState("");
  const [onlyThisLesson, setOnlyThisLesson] = useState(false);
  const [open, setOpen] = useState<DiscussionThread | null>(null);
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", lesson: "" });
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string; title?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lessonFilter = onlyThisLesson ? currentLesson?.id : undefined;
  const load = useCallback(async (q = "") => {
    try {
      setThreads((await listDiscussions(programId, token(), { lesson: lessonFilter, q })).results);
      setFailed("");
    } catch (err) {
      setFailed(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [programId, lessonFilter, t]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  // A render helper rather than a nested component, so typing in the edit box doesn't remount it and lose focus.
  function renderPost(post: DiscussionPost, isThread: boolean) {
    const isEditing = editing?.id === post.id;
    return (
      <div className={`rounded-xl p-4 ${post.author_is_staff ? "border border-amber-200 bg-amber-50/60" : "border border-slate-200 bg-white"}`}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-900">{post.author_name}</span>
          {post.author_is_staff && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">{t("staffBadge")}</span>}
          <span>{when(post.created_at)}</span>
          {post.edited_at && <span>· {t("edited")}</span>}
          <span className="ml-auto flex gap-3">
            {post.can_edit && !isEditing && (
              <button onClick={() => setEditing({ id: post.id, body: post.body, title: isThread ? post.title : undefined })} className="font-semibold text-[var(--navy)] underline">{t("edit")}</button>
            )}
            {post.can_delete && (
              <button
                onClick={() => window.confirm(t("deleteConfirm")) && act(async () => {
                  const updated = await deleteDiscussionPost(programId, post.id, token());
                  if (isThread || !updated) {
                    setOpen(null);
                    await load(query);
                  } else setOpen(updated);
                })}
                disabled={busy}
                className="font-semibold text-red-600 underline"
              >
                {t("delete")}
              </button>
            )}
          </span>
        </div>
        {isEditing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                setOpen(await editDiscussionPost(programId, post.id, { body: editing.body, title: editing.title }, token()));
                setEditing(null);
              });
            }}
            className="flex flex-col gap-2"
          >
            {editing.title !== undefined && (
              <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={200} aria-label={t("titleLabel")} className="rounded-lg border px-3 py-2 text-sm" />
            )}
            <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={3} maxLength={5000} aria-label={t("bodyLabel")} className="rounded-lg border px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button disabled={busy} className="rounded-lg bg-[var(--navy)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{t("save")}</button>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border px-4 py-1.5 text-sm">{t("cancel")}</button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{post.body}</p>
        )}
      </div>
    );
  }

  return (
    <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-[family-name:var(--font-display)] text-xl font-bold text-slate-900">💬 {t("title")}</h2>
        {!open && !asking && (
          <button
            onClick={() => { setDraft({ title: "", body: "", lesson: currentLesson?.id ?? "" }); setError(""); setAsking(true); }}
            className="rounded-xl bg-[var(--navy)] px-4 py-2 text-sm font-bold text-white hover:bg-[#25396a]"
          >
            + {t("ask")}
          </button>
        )}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}

      {asking ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const created = await startDiscussion(programId, { title: draft.title.trim(), body: draft.body.trim(), lesson: draft.lesson || undefined }, token());
              setAsking(false);
              setOpen(created);
              await load(query);
            });
          }}
          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
        >
          <input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} placeholder={t("titlePlaceholder")} aria-label={t("titleLabel")} className="rounded-lg border px-3 py-2 text-sm" />
          <textarea required value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4} maxLength={5000} placeholder={t("bodyPlaceholder")} aria-label={t("bodyLabel")} className="rounded-lg border px-3 py-2 text-sm" />
          <select value={draft.lesson} onChange={(e) => setDraft({ ...draft, lesson: e.target.value })} aria-label={t("aboutLesson")} className="rounded-lg border bg-white px-3 py-2 text-sm">
            <option value="">{t("generalQuestion")}</option>
            {lessons.map((l) => <option key={l.id} value={l.id}>{t("aboutLessonOption", { title: l.title })}</option>)}
          </select>
          <div className="flex gap-2">
            <button disabled={busy || !draft.title.trim() || !draft.body.trim()} className="rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? t("posting") : t("post")}</button>
            <button type="button" onClick={() => setAsking(false)} className="rounded-lg border px-4 py-2 text-sm">{t("cancel")}</button>
          </div>
        </form>
      ) : open ? (
        <div>
          <button onClick={() => { setOpen(null); setEditing(null); void load(query); }} className="mb-3 text-sm font-semibold text-[var(--navy)] hover:underline">← {t("allThreads")}</button>
          <h3 className="mb-1 text-lg font-bold text-slate-900">{open.title}</h3>
          {open.lesson && <p className="mb-3 text-xs text-slate-500">📖 {open.lesson.title}</p>}
          <div className="space-y-3">
            {renderPost(open, true)}
            {open.replies.map((r) => <div key={r.id} className="ml-4 md:ml-8">{renderPost(r, false)}</div>)}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                setOpen(await replyToDiscussion(programId, open.id, reply.trim(), token()));
                setReply("");
              });
            }}
            className="mt-4 flex flex-col gap-2"
          >
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={5000} placeholder={t("replyPlaceholder")} aria-label={t("replyPlaceholder")} className="rounded-lg border bg-white px-3 py-2 text-sm" />
            <button disabled={busy || !reply.trim()} className="self-start rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? t("posting") : t("reply")}</button>
          </form>
        </div>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); void load(query); }} className="mb-3 flex flex-wrap items-center gap-2">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-sm" />
            <button className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">{t("search")}</button>
            {currentLesson && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={onlyThisLesson} onChange={(e) => setOnlyThisLesson(e.target.checked)} className="accent-[var(--navy)]" />
                {t("onlyThisLesson")}
              </label>
            )}
          </form>
          {failed ? (
            <p className="text-sm text-slate-500">{failed}</p>
          ) : !threads ? (
            <p className="text-sm text-slate-400">…</p>
          ) : threads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">{t("empty")}</p>
          ) : (
            <ul className="space-y-2">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    onClick={() => act(async () => setOpen(await getDiscussion(programId, thread.id, token())))}
                    className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-[var(--navy)]/30 hover:shadow-sm"
                  >
                    <p className="font-semibold text-slate-900">{thread.title}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">{thread.body}</p>
                    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{thread.author_name}</span>
                      {thread.lesson && <span>📖 {thread.lesson.title}</span>}
                      <span>💬 {t("replies", { count: thread.reply_count })}</span>
                      {thread.answered_by_staff && <span className="font-semibold text-amber-700">✓ {t("answeredByStaff")}</span>}
                      <span>{when(thread.last_activity_at)}</span>
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

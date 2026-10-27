"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { addPostComment, deletePostComment, getPostComments, type PostComment, type ReelPost } from "@/lib/api";
import { IconX } from "@/components/Icons";

/** Bottom sheet on phones, side panel on desktop — comments for one video. */
export default function CommentsSheet({
  post, loggedIn, onClose, onCountChange,
}: {
  post: ReelPost;
  loggedIn: boolean;
  onClose: () => void;
  onCountChange: (postId: string, count: number) => void;
}) {
  const t = useTranslations("VideosPage");
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("access_token") || undefined;
    getPostComments(post.id, token)
      .then((data) => { if (!cancelled) setComments(data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [post.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    const body = text.trim();
    if (!token || !body || sending) return;
    setSending(true);
    setFailed(false);
    try {
      const created = await addPostComment(post.id, body, token);
      const next = [...(comments ?? []), { ...created, is_mine: true }];
      setComments(next);
      setText("");
      onCountChange(post.id, next.length);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(comment: PostComment) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await deletePostComment(comment.id, token);
      const next = (comments ?? []).filter((c) => c.id !== comment.id);
      setComments(next);
      onCountChange(post.id, next.length);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end md:items-stretch md:justify-end">
      <button type="button" aria-label={t("close")} onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div
        role="dialog" aria-modal="true" aria-label={t("comments")}
        className="relative flex max-h-[72%] w-full flex-col rounded-t-3xl bg-white text-slate-900 shadow-2xl animate-rise-in md:max-h-none md:w-[400px] md:rounded-none md:rounded-l-3xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-extrabold">{t("commentsTitle", { count: comments?.length ?? post.comment_count })}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
            <IconX size={16} />
          </button>
        </div>

        <ul ref={listRef} className="min-h-40 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {comments === null && !failed && <li className="text-sm text-slate-500">{t("loading")}</li>}
          {comments?.length === 0 && <li className="py-6 text-center text-sm text-slate-500">{t("noComments")}</li>}
          {comments?.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-amber-300">
                {(comment.author_name.charAt(0) || "?").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-500">{comment.author_name}</p>
                <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{comment.text}</p>
              </div>
              {comment.is_mine && (
                <button type="button" onClick={() => handleDelete(comment)} className="self-start text-xs font-semibold text-rose-600 hover:underline">
                  {t("deleteComment")}
                </button>
              )}
            </li>
          ))}
        </ul>

        {failed && <p role="alert" className="px-4 pb-2 text-xs text-rose-600">{t("actionFailed")}</p>}

        {loggedIn ? (
          <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-slate-100 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <input
              value={text} onChange={(e) => setText(e.target.value)} maxLength={1000}
              placeholder={t("commentPlaceholder")} aria-label={t("commentPlaceholder")}
              className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            />
            <button
              type="submit" disabled={sending || !text.trim()}
              className="rounded-full bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {t("sendComment")}
            </button>
          </form>
        ) : (
          <p className="border-t border-slate-100 p-4 text-center text-sm text-slate-600">
            <Link href="/login" className="font-bold text-slate-900 underline">{t("signInToComment")}</Link>
          </p>
        )}
      </div>
    </div>
  );
}

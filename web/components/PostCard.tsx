"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  reactToPost, removePostReaction, getPostComments, addPostComment, deletePostComment, deletePost, reportPost,
  type SocialPost, type PostComment, type PostReportReason,
} from "@/lib/api";
import ReportContentButton from "@/components/ReportContentButton";
import { IconCheckCircle, IconHome, IconMessageCircle } from "@/components/Icons";

const EMOJIS: Record<string, string> = { LIKE: "👍", LOVE: "❤️", LAUGH: "😂", WOW: "😮", SAD: "😢" };
const REPORT_REASONS: PostReportReason[] = ["INAPPROPRIATE_CONTENT", "SCAM_SUSPECTED", "HARASSMENT", "OTHER"];
const MAX_COMMENT_LENGTH = 1000;

interface PostCardProps {
  post: SocialPost;
  onDeleted?: (postId: string) => void;
  onTagClick?: (tag: string) => void;
}

export default function PostCard({ post, onDeleted, onTagClick }: PostCardProps) {
  const t = useTranslations("FeedPage");
  const locale = useLocale();
  const router = useRouter();
  const [reactionCounts, setReactionCounts] = useState(post.reaction_counts);
  const [myReaction, setMyReaction] = useState(post.my_reaction);
  const [showComments, setShowComments] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState<PostReportReason>("INAPPROPRIATE_CONTENT");
  const [reported, setReported] = useState(false);

  function requireToken(): string | null {
    const token = localStorage.getItem("access_token");
    if (!token) router.push("/login");
    return token;
  }

  async function handleReact(emoji: string) {
    const token = requireToken();
    if (!token || busy) return;
    setError("");
    setBusy(true);
    try {
      // Tapping your current reaction again takes it back, like every other social feed.
      const result = myReaction === emoji ? await removePostReaction(post.id, token) : await reactToPost(post.id, emoji, token);
      setReactionCounts(result.reaction_counts);
      setMyReaction(result.my_reaction);
    } catch {
      setError(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleComments() {
    if (showComments) {
      setShowComments(false);
      return;
    }
    setShowComments(true);
    setCommentsLoading(true);
    setError("");
    try {
      setComments(await getPostComments(post.id, localStorage.getItem("access_token") || undefined));
    } catch {
      setError(t("actionFailed"));
    } finally {
      setCommentsLoading(false);
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    const token = requireToken();
    const text = commentDraft.trim();
    if (!token || !text || busy) return;
    setError("");
    setBusy(true);
    try {
      const comment = await addPostComment(post.id, text, token);
      setComments((prev) => [...prev, comment]);
      setCommentDraft("");
      setCommentCount((c) => c + 1);
    } catch {
      setError(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    const token = requireToken();
    if (!token) return;
    setError("");
    try {
      await deletePostComment(commentId, token);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setCommentCount((c) => Math.max(0, c - 1));
    } catch {
      setError(t("actionFailed"));
    }
  }

  async function handleDeletePost() {
    const token = requireToken();
    if (!token || !window.confirm(t("confirmDelete"))) return;
    setError("");
    try {
      await deletePost(post.id, token);
      onDeleted?.(post.id);
    } catch {
      setError(t("actionFailed"));
    }
  }

  async function handleReport(e: React.FormEvent) {
    e.preventDefault();
    const token = requireToken();
    if (!token || busy) return;
    setError("");
    setBusy(true);
    try {
      await reportPost(post.id, reportReason, token);
      setReported(true);
      setReporting(false);
    } catch {
      setError(t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  const postedAt = post.published_at || post.created_at;

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="p-5">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-base font-black text-amber-300" aria-hidden="true">
            {(post.author_name.charAt(0) || "?").toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-black text-slate-900">{post.author_name}</span>
              {post.is_verified_creator && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">
                  <IconCheckCircle size={11} /> {t("verifiedBadge")}
                </span>
              )}
              {post.is_sponsored && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{t("sponsoredBadge")}</span>
              )}
              {post.status !== "PUBLISHED" && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{t("notPublishedBadge")}</span>
              )}
            </div>
            <time dateTime={postedAt} className="text-xs font-medium text-slate-400">
              {new Date(postedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
            </time>
          </div>
        </div>
        {post.linked_listing_id && (
          <Link
            href={`/listing/${post.linked_listing_id}`}
            className="mb-3 inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900 transition-colors hover:bg-amber-100"
          >
            <IconHome size={14} /> {t("realEstateBadge")}
          </Link>
        )}
        {post.caption && <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-slate-800">{post.caption}</p>}
        {post.tag_names.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold text-amber-700">
            {post.tag_names.map((tag) => (
              <button key={tag} type="button" onClick={() => onTagClick?.(tag)} className="cursor-pointer hover:underline">
                #{tag}
              </button>
            ))}
          </p>
        )}
      </div>

      {post.media.length > 0 && (
        <div className="flex flex-col gap-1 bg-slate-100">
          {post.media.map((item) =>
            item.media_type === "VIDEO" ? (
              <video key={item.id} src={item.file_url} controls preload="metadata" playsInline className="w-full max-h-[32rem] bg-black" />
            ) : item.media_type === "AUDIO" ? (
              <audio key={item.id} src={item.file_url} controls preload="none" className="w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={item.id} src={item.file_url} alt={post.caption.slice(0, 80) || post.author_name} loading="lazy" className="w-full max-h-[32rem] object-cover" />
            ),
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
        <div className="flex gap-1">
          {Object.entries(EMOJIS).map(([key, emoji]) => (
            <button
              key={key} type="button" onClick={() => handleReact(key)} disabled={busy}
              aria-pressed={myReaction === key} aria-label={t(`reaction.${key}`)} title={t(`reaction.${key}`)}
              className={`flex items-center rounded-full px-2 py-1 text-lg transition-all hover:scale-110 disabled:opacity-60 ${myReaction === key ? "bg-amber-100 ring-1 ring-amber-400" : "hover:bg-slate-100"}`}
            >
              {emoji}
              {reactionCounts[key] > 0 && <span className="ml-1 text-xs font-bold text-slate-500">{reactionCounts[key]}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button" onClick={toggleComments} aria-expanded={showComments}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <IconMessageCircle size={16} /> {t("comments", { count: commentCount })}
          </button>
          {post.is_mine ? (
            <button type="button" onClick={handleDeletePost} className="text-xs font-semibold text-red-600 hover:underline">{t("deletePost")}</button>
          ) : reported ? (
            <span className="text-xs text-slate-400">{t("reportSent")}</span>
          ) : (
            <button type="button" onClick={() => setReporting((v) => !v)} className="text-xs font-semibold text-slate-400 hover:text-red-600">{t("report")}</button>
          )}
        </div>
      </div>

      {reporting && (
        <form onSubmit={handleReport} className="flex flex-wrap items-center gap-2 px-4 pb-4">
          <label htmlFor={`report-${post.id}`} className="sr-only">{t("reportReasonLabel")}</label>
          <select
            id={`report-${post.id}`} value={reportReason} onChange={(e) => setReportReason(e.target.value as PostReportReason)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {REPORT_REASONS.map((reason) => (
              <option key={reason} value={reason}>{t(`reportReason.${reason}`)}</option>
            ))}
          </select>
          <button type="submit" disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{t("reportSubmit")}</button>
          <button type="button" onClick={() => setReporting(false)} className="text-sm font-semibold text-slate-500">{t("cancel")}</button>
        </form>
      )}

      {error && <p role="alert" className="px-4 pb-3 text-xs text-red-600">{error}</p>}

      {showComments && (
        <div className="border-t border-slate-100 bg-slate-50/70 p-4">
          {commentsLoading ? (
            <p className="mb-3 text-sm text-slate-500">{t("loading")}</p>
          ) : comments.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">{t("noComments")}</p>
          ) : (
            <div className="mb-3 flex flex-col gap-2.5">
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2.5 text-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-black text-slate-700" aria-hidden="true">
                    {(c.author_name.charAt(0) || "?").toUpperCase()}
                  </span>
                  <p className="min-w-0 flex-1 break-words rounded-2xl rounded-tl-md bg-white px-3 py-2 shadow-sm">
                    <span className="font-bold text-slate-900">{c.author_name}</span>{" "}
                    <span className="text-slate-700">{c.text}</span>
                  </p>
                  {c.is_mine ? (
                    <button type="button" onClick={() => handleDeleteComment(c.id)} className="shrink-0 pt-2 text-xs font-semibold text-red-600 hover:underline">
                      {t("deleteComment")}
                    </button>
                  ) : (
                    <ReportContentButton kind="comment" id={String(c.id)} variant="inline" />
                  )}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleAddComment} className="flex gap-2">
            <input
              type="text" value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} maxLength={MAX_COMMENT_LENGTH}
              placeholder={t("commentPlaceholder")} aria-label={t("commentPlaceholder")}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-400/15"
            />
            <button type="submit" disabled={busy || !commentDraft.trim()} aria-label={t("sendComment")} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-50">→</button>
          </form>
        </div>
      )}
    </article>
  );
}

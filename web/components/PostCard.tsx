"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  reactToPost, removePostReaction, getPostComments, addPostComment, deletePostComment, deletePost, reportPost,
  type SocialPost, type PostComment, type PostReportReason,
} from "@/lib/api";

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
    <article className="border rounded-lg bg-white overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="font-semibold text-[var(--navy)] text-sm">{post.author_name}</span>
          {post.is_verified_creator && (
            <span className="text-xs bg-[var(--navy)] text-white px-2 py-0.5 rounded-full">✓ {t("verifiedBadge")}</span>
          )}
          {post.is_sponsored && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{t("sponsoredBadge")}</span>
          )}
          {post.linked_listing_id && (
            <Link href={`/listing/${post.linked_listing_id}`} className="text-xs bg-[var(--gold)]/20 text-[#8A6D14] px-2 py-0.5 rounded font-semibold">
              🏠 {t("realEstateBadge")}
            </Link>
          )}
          {post.status !== "PUBLISHED" && (
            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">{t("notPublishedBadge")}</span>
          )}
          <time dateTime={postedAt} className="text-xs text-gray-400 ml-auto">
            {new Date(postedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
          </time>
        </div>
        {post.caption && <p className="text-gray-800 text-sm mb-2 whitespace-pre-line break-words">{post.caption}</p>}
        {post.tag_names.length > 0 && (
          <p className="text-xs text-[var(--navy)] mb-2 flex flex-wrap gap-x-2">
            {post.tag_names.map((tag) => (
              <button key={tag} type="button" onClick={() => onTagClick?.(tag)} className="hover:underline cursor-pointer">
                #{tag}
              </button>
            ))}
          </p>
        )}
      </div>

      {post.media.length > 0 && (
        <div className="flex flex-col gap-1 bg-gray-100">
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

      <div className="p-4 border-t flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1">
          {Object.entries(EMOJIS).map(([key, emoji]) => (
            <button
              key={key} type="button" onClick={() => handleReact(key)} disabled={busy}
              aria-pressed={myReaction === key} aria-label={t(`reaction.${key}`)} title={t(`reaction.${key}`)}
              className={`text-lg rounded-full px-1.5 hover:scale-110 transition-transform disabled:opacity-60 ${myReaction === key ? "bg-[var(--gold)]/25 ring-1 ring-[var(--gold)]" : ""}`}
            >
              {emoji}
              {reactionCounts[key] > 0 && <span className="text-xs text-gray-500 ml-0.5">{reactionCounts[key]}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={toggleComments} aria-expanded={showComments} className="text-sm text-gray-500 hover:text-[var(--navy)]">
            💬 {t("comments", { count: commentCount })}
          </button>
          {post.is_mine ? (
            <button type="button" onClick={handleDeletePost} className="text-xs text-red-600 hover:underline">{t("deletePost")}</button>
          ) : reported ? (
            <span className="text-xs text-gray-400">{t("reportSent")}</span>
          ) : (
            <button type="button" onClick={() => setReporting((v) => !v)} className="text-xs text-gray-400 hover:text-red-600">{t("report")}</button>
          )}
        </div>
      </div>

      {reporting && (
        <form onSubmit={handleReport} className="px-4 pb-4 flex items-center gap-2 flex-wrap">
          <label htmlFor={`report-${post.id}`} className="sr-only">{t("reportReasonLabel")}</label>
          <select
            id={`report-${post.id}`} value={reportReason} onChange={(e) => setReportReason(e.target.value as PostReportReason)}
            className="border rounded px-2 py-1 text-sm"
          >
            {REPORT_REASONS.map((reason) => (
              <option key={reason} value={reason}>{t(`reportReason.${reason}`)}</option>
            ))}
          </select>
          <button type="submit" disabled={busy} className="bg-red-600 text-white text-sm font-semibold px-3 py-1 rounded disabled:opacity-50">{t("reportSubmit")}</button>
          <button type="button" onClick={() => setReporting(false)} className="text-sm text-gray-500">{t("cancel")}</button>
        </form>
      )}

      {error && <p role="alert" className="text-red-600 text-xs px-4 pb-2">{error}</p>}

      {showComments && (
        <div className="p-4 border-t bg-gray-50">
          {commentsLoading ? (
            <p className="text-sm text-gray-500 mb-3">{t("loading")}</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-gray-500 mb-3">{t("noComments")}</p>
          ) : (
            <div className="flex flex-col gap-2 mb-3">
              {comments.map((c) => (
                <div key={c.id} className="text-sm flex items-start justify-between gap-2">
                  <p className="break-words min-w-0">
                    <span className="font-semibold text-[var(--navy)]">{c.author_name}</span>{" "}
                    <span className="text-gray-700">{c.text}</span>
                  </p>
                  {c.is_mine && (
                    <button type="button" onClick={() => handleDeleteComment(c.id)} className="text-xs text-red-600 hover:underline shrink-0">
                      {t("deleteComment")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleAddComment} className="flex gap-2">
            <input
              type="text" value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} maxLength={MAX_COMMENT_LENGTH}
              placeholder={t("commentPlaceholder")} aria-label={t("commentPlaceholder")}
              className="flex-1 border rounded px-3 py-1 text-sm"
            />
            <button type="submit" disabled={busy || !commentDraft.trim()} aria-label={t("sendComment")} className="bg-[var(--navy)] text-white text-sm font-semibold px-3 py-1 rounded disabled:opacity-50">→</button>
          </form>
        </div>
      )}
    </article>
  );
}

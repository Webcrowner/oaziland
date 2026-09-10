"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { reactToPost, getPostComments, addPostComment, type SocialPost, type PostComment } from "@/lib/api";

const EMOJIS: Record<string, string> = { LIKE: "👍", LOVE: "❤️", LAUGH: "😂", WOW: "😮", SAD: "😢" };

export default function PostCard({ post }: { post: SocialPost }) {
  const t = useTranslations("FeedPage");
  const router = useRouter();
  const [reactionCounts, setReactionCounts] = useState(post.reaction_counts);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [error, setError] = useState("");

  async function handleReact(emoji: string) {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setError("");
    try {
      const result = await reactToPost(post.id, emoji, token);
      setReactionCounts(result.reaction_counts);
    } catch {
      setError(t("actionFailed"));
    }
  }

  async function toggleComments() {
    if (!showComments) {
      try {
        const fetched = await getPostComments(post.id);
        setComments(fetched);
      } catch {
        setError(t("actionFailed"));
        return;
      }
    }
    setShowComments(!showComments);
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    if (!commentDraft.trim()) return;
    setError("");
    try {
      const comment = await addPostComment(post.id, commentDraft, token);
      setComments((prev) => [...prev, comment]);
      setCommentDraft("");
      setCommentCount((c) => c + 1);
    } catch {
      setError(t("actionFailed"));
    }
  }

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
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
        </div>
        <p className="text-gray-800 text-sm mb-2">{post.caption}</p>
        {post.tag_names.length > 0 && (
          <p className="text-xs text-[var(--navy)] mb-2">{post.tag_names.map((tag) => `#${tag}`).join(" ")}</p>
        )}
      </div>

      {post.media.length > 0 && (
        <div className="h-64 bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
          {post.media[0].media_type}
        </div>
      )}

      <div className="p-4 border-t flex items-center justify-between">
        <div className="flex gap-1">
          {Object.entries(EMOJIS).map(([key, emoji]) => (
            <button key={key} onClick={() => handleReact(key)} className="text-lg hover:scale-110 transition-transform" title={key}>
              {emoji}
              {reactionCounts[key] > 0 && <span className="text-xs text-gray-500 ml-0.5">{reactionCounts[key]}</span>}
            </button>
          ))}
        </div>
        <button onClick={toggleComments} className="text-sm text-gray-500 hover:text-[var(--navy)]">
          💬 {t("comments", { count: commentCount })}
        </button>
      </div>

      {error && <p className="text-red-600 text-xs px-4 pb-2">{error}</p>}

      {showComments && (
        <div className="p-4 border-t bg-gray-50">
          <div className="flex flex-col gap-2 mb-3">
            {comments.map((c) => (
              <div key={c.id} className="text-sm">
                <span className="font-semibold text-[var(--navy)]">{c.author_name}</span>{" "}
                <span className="text-gray-700">{c.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={handleAddComment} className="flex gap-2">
            <input
              type="text" value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)}
              className="flex-1 border rounded px-3 py-1 text-sm"
            />
            <button type="submit" className="bg-[var(--navy)] text-white text-sm font-semibold px-3 py-1 rounded">→</button>
          </form>
        </div>
      )}
    </div>
  );
}

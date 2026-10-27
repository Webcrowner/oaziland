import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image, Linking } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  reactToPost, removePostReaction, getPostComments, addPostComment, deletePostComment, deletePost, reportPost,
  SocialPost, PostComment, PostReportReason,
} from "../lib/api";

const EMOJIS: Record<string, string> = { LIKE: "👍", LOVE: "❤️", LAUGH: "😂", WOW: "😮", SAD: "😢" };
const REPORT_REASONS: { value: PostReportReason; label: string }[] = [
  { value: "INAPPROPRIATE_CONTENT", label: "Inappropriate" },
  { value: "SCAM_SUSPECTED", label: "Scam" },
  { value: "HARASSMENT", label: "Harassment" },
  { value: "OTHER", label: "Other" },
];
const MAX_COMMENT_LENGTH = 1000;

interface Props {
  post: SocialPost;
  onOpenListing?: (listingId: string) => void;
  onTagPress?: (tag: string) => void;
  onDeleted?: (postId: string) => void;
}

/**
 * The mobile equivalent of the web app's real PostCard — same real
 * actions (react / un-react, comment, delete own post or comment,
 * report), same badges (premium checkmark, sponsored, real-estate
 * link) and real media. Photos render inline; video and audio open in
 * the device's own player, since no media-playback module is bundled.
 */
export default function PostCard({ post, onOpenListing, onTagPress, onDeleted }: Props) {
  const [reactionCounts, setReactionCounts] = useState(post.reaction_counts);
  const [myReaction, setMyReaction] = useState(post.my_reaction);
  const [showComments, setShowComments] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  async function requireToken(message: string): Promise<boolean> {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) Alert.alert("Sign in required", message);
    return !!token;
  }

  function actionFailed() {
    Alert.alert("That action failed", "Please try again.");
  }

  async function handleReact(emoji: string) {
    if (busy || !(await requireToken("Please sign in to react to posts."))) return;
    setBusy(true);
    try {
      // Tapping your current reaction again takes it back, like every other social feed.
      const result = myReaction === emoji ? await removePostReaction(post.id) : await reactToPost(post.id, emoji);
      setReactionCounts(result.reaction_counts);
      setMyReaction(result.my_reaction);
    } catch {
      actionFailed();
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
    try {
      setComments(await getPostComments(post.id));
    } catch {
      setShowComments(false);
      actionFailed();
    } finally {
      setCommentsLoading(false);
    }
  }

  async function handleAddComment() {
    const text = commentDraft.trim();
    if (!text || busy || !(await requireToken("Please sign in to comment."))) return;
    setBusy(true);
    try {
      const comment = await addPostComment(post.id, text);
      setComments((prev) => [...prev, comment]);
      setCommentDraft("");
      setCommentCount((c) => c + 1);
    } catch {
      actionFailed();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      await deletePostComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setCommentCount((c) => Math.max(0, c - 1));
    } catch {
      actionFailed();
    }
  }

  function confirmDeletePost() {
    Alert.alert("Delete this post?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deletePost(post.id);
            onDeleted?.(post.id);
          } catch {
            actionFailed();
          }
        },
      },
    ]);
  }

  async function handleReport(reason: PostReportReason) {
    if (busy || !(await requireToken("Please sign in to report a post."))) return;
    setBusy(true);
    try {
      await reportPost(post.id, reason);
      setReported(true);
      setReporting(false);
    } catch {
      actionFailed();
    } finally {
      setBusy(false);
    }
  }

  const postedAt = new Date(post.published_at || post.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.authorName}>{post.author_name}</Text>
        {post.is_verified_creator && <Text style={styles.verifiedBadge}>✓ Premium</Text>}
        {post.is_sponsored && <Text style={styles.sponsoredBadge}>Sponsored</Text>}
        {post.linked_listing_id && (
          <TouchableOpacity onPress={() => onOpenListing?.(post.linked_listing_id!)}>
            <Text style={styles.realEstateBadge}>🏠 Property</Text>
          </TouchableOpacity>
        )}
        {post.status !== "PUBLISHED" && <Text style={styles.unpublishedBadge}>Not published</Text>}
      </View>
      <Text style={styles.timestamp}>{postedAt}</Text>

      {!!post.caption && <Text style={styles.caption}>{post.caption}</Text>}
      {post.tag_names.length > 0 && (
        <View style={styles.tagsRow}>
          {post.tag_names.map((tag) => (
            <TouchableOpacity key={tag} onPress={() => onTagPress?.(tag)}>
              <Text style={styles.tags}>#{tag}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {post.media.map((item) =>
        item.media_type === "PHOTO" ? (
          <Image key={item.id} source={{ uri: item.file_url }} style={styles.mediaImage} resizeMode="cover" />
        ) : (
          <TouchableOpacity key={item.id} style={styles.mediaPlay} onPress={() => Linking.openURL(item.file_url).catch(actionFailed)}>
            <Text style={styles.mediaPlayText}>{item.media_type === "VIDEO" ? "▶ Play video" : "▶ Play audio"}</Text>
          </TouchableOpacity>
        ),
      )}

      <View style={styles.actionsRow}>
        <View style={styles.reactionsRow}>
          {Object.entries(EMOJIS).map(([key, emoji]) => (
            <TouchableOpacity
              key={key} onPress={() => handleReact(key)} disabled={busy}
              style={[styles.reactionButton, myReaction === key && styles.reactionSelected]}
              accessibilityRole="button" accessibilityState={{ selected: myReaction === key }} accessibilityLabel={key.toLowerCase()}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
              {reactionCounts[key] > 0 && <Text style={styles.reactionCount}>{reactionCounts[key]}</Text>}
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={toggleComments}>
          <Text style={styles.commentsLink}>💬 {commentCount} comments</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footerRow}>
        {post.is_mine ? (
          <TouchableOpacity onPress={confirmDeletePost}>
            <Text style={styles.dangerLink}>Delete</Text>
          </TouchableOpacity>
        ) : reported ? (
          <Text style={styles.mutedLink}>Reported</Text>
        ) : (
          <TouchableOpacity onPress={() => setReporting((v) => !v)}>
            <Text style={styles.mutedLink}>Report</Text>
          </TouchableOpacity>
        )}
      </View>

      {reporting && (
        <View style={styles.reportRow}>
          {REPORT_REASONS.map((r) => (
            <TouchableOpacity key={r.value} style={styles.reportChip} disabled={busy} onPress={() => handleReport(r.value)}>
              <Text style={styles.reportChipText}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showComments && (
        <View style={styles.commentsSection}>
          {commentsLoading ? (
            <Text style={styles.commentMuted}>Loading…</Text>
          ) : comments.length === 0 ? (
            <Text style={styles.commentMuted}>No comments yet.</Text>
          ) : (
            comments.map((c) => (
              <View key={c.id} style={styles.commentRow}>
                <Text style={[styles.commentText, styles.commentBody]}>
                  <Text style={styles.commentAuthor}>{c.author_name} </Text>
                  {c.text}
                </Text>
                {c.is_mine && (
                  <TouchableOpacity onPress={() => handleDeleteComment(c.id)}>
                    <Text style={styles.dangerLink}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput} value={commentDraft} onChangeText={setCommentDraft}
              placeholder="Add a comment..." maxLength={MAX_COMMENT_LENGTH}
            />
            <TouchableOpacity onPress={handleAddComment} disabled={busy || !commentDraft.trim()}>
              <Text style={[styles.commentSend, (busy || !commentDraft.trim()) && styles.disabled]}>→</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 16, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 2 },
  authorName: { fontWeight: "700", color: "#1B2A4A", fontSize: 14 },
  verifiedBadge: { fontSize: 11, backgroundColor: "#1B2A4A", color: "#fff", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  sponsoredBadge: { fontSize: 11, backgroundColor: "#F3F4F6", color: "#6B7280", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  realEstateBadge: { fontSize: 11, fontWeight: "700", backgroundColor: "#FBF3DC", color: "#8A6D14", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  unpublishedBadge: { fontSize: 11, backgroundColor: "#FEF3C7", color: "#92400E", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  timestamp: { fontSize: 11, color: "#9CA3AF", marginBottom: 8 },
  caption: { fontSize: 14, color: "#1F2937", marginBottom: 6 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  tags: { fontSize: 12, color: "#1B2A4A" },
  mediaImage: { height: 220, width: "100%", borderRadius: 8, marginBottom: 10, backgroundColor: "#F3F4F6" },
  mediaPlay: { height: 56, backgroundColor: "#1B2A4A", justifyContent: "center", alignItems: "center", borderRadius: 8, marginBottom: 10 },
  mediaPlayText: { color: "#fff", fontWeight: "700" },
  actionsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  reactionsRow: { flexDirection: "row", gap: 6 },
  reactionButton: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 12 },
  reactionSelected: { backgroundColor: "#FBF3DC", borderWidth: 1, borderColor: "#C9A227" },
  reactionEmoji: { fontSize: 16 },
  reactionCount: { fontSize: 11, color: "#6B7280" },
  commentsLink: { fontSize: 12, color: "#6B7280" },
  footerRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 6 },
  dangerLink: { fontSize: 12, color: "#DC2626" },
  mutedLink: { fontSize: 12, color: "#9CA3AF" },
  reportRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  reportChip: { borderWidth: 1, borderColor: "#DC2626", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  reportChipText: { color: "#DC2626", fontSize: 12 },
  commentsSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  commentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  commentBody: { flex: 1 },
  commentMuted: { fontSize: 13, color: "#6B7280", marginBottom: 6 },
  commentText: { fontSize: 13, color: "#374151" },
  commentAuthor: { fontWeight: "700", color: "#1B2A4A" },
  commentInputRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  commentInput: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, fontSize: 13 },
  commentSend: { color: "#1B2A4A", fontWeight: "700", fontSize: 16, paddingHorizontal: 6, paddingTop: 4 },
  disabled: { opacity: 0.4 },
});

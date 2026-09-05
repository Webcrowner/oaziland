import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import { reactToPost, getPostComments, addPostComment, SocialPost, PostComment } from "../lib/api";

const EMOJIS: Record<string, string> = { LIKE: "👍", LOVE: "❤️", LAUGH: "😂", WOW: "😮", SAD: "😢" };

interface Props {
  post: SocialPost;
  onOpenListing?: (listingId: string) => void;
}

/**
 * The mobile equivalent of the web app's real PostCard — same real
 * actions (react, comment), same badges (premium checkmark, sponsored,
 * real-estate link). Real error handling on every action, the same
 * fix already made on web after a review pass found these calls had
 * none originally.
 */
export default function PostCard({ post, onOpenListing }: Props) {
  const [reactionCounts, setReactionCounts] = useState(post.reaction_counts);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentCount, setCommentCount] = useState(post.comment_count);

  async function handleReact(emoji: string) {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      Alert.alert("Sign in required", "Please sign in to react to posts.");
      return;
    }
    try {
      const result = await reactToPost(post.id, emoji);
      setReactionCounts(result.reaction_counts);
    } catch {
      Alert.alert("That action failed", "Please try again.");
    }
  }

  async function toggleComments() {
    if (!showComments) {
      try {
        const fetched = await getPostComments(post.id);
        setComments(fetched);
      } catch {
        Alert.alert("That action failed", "Please try again.");
        return;
      }
    }
    setShowComments(!showComments);
  }

  async function handleAddComment() {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      Alert.alert("Sign in required", "Please sign in to comment.");
      return;
    }
    if (!commentDraft.trim()) return;
    try {
      const comment = await addPostComment(post.id, commentDraft);
      setComments((prev) => [...prev, comment]);
      setCommentDraft("");
      setCommentCount((c) => c + 1);
    } catch {
      Alert.alert("That action failed", "Please try again.");
    }
  }

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
      </View>

      <Text style={styles.caption}>{post.caption}</Text>
      {post.tag_names.length > 0 && (
        <Text style={styles.tags}>{post.tag_names.map((tag) => `#${tag}`).join(" ")}</Text>
      )}

      {post.media.length > 0 && (
        <View style={styles.mediaPlaceholder}>
          <Text style={styles.mediaPlaceholderText}>{post.media[0].media_type}</Text>
        </View>
      )}

      <View style={styles.actionsRow}>
        <View style={styles.reactionsRow}>
          {Object.entries(EMOJIS).map(([key, emoji]) => (
            <TouchableOpacity key={key} onPress={() => handleReact(key)} style={styles.reactionButton}>
              <Text style={styles.reactionEmoji}>{emoji}</Text>
              {reactionCounts[key] > 0 && <Text style={styles.reactionCount}>{reactionCounts[key]}</Text>}
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={toggleComments}>
          <Text style={styles.commentsLink}>💬 {commentCount} comments</Text>
        </TouchableOpacity>
      </View>

      {showComments && (
        <View style={styles.commentsSection}>
          {comments.map((c) => (
            <Text key={c.id} style={styles.commentText}>
              <Text style={styles.commentAuthor}>{c.author_name} </Text>
              {c.text}
            </Text>
          ))}
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput} value={commentDraft} onChangeText={setCommentDraft}
              placeholder="Add a comment..."
            />
            <TouchableOpacity onPress={handleAddComment}>
              <Text style={styles.commentSend}>→</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 16, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  authorName: { fontWeight: "700", color: "#1B2A4A", fontSize: 14 },
  verifiedBadge: { fontSize: 11, backgroundColor: "#1B2A4A", color: "#fff", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  sponsoredBadge: { fontSize: 11, backgroundColor: "#F3F4F6", color: "#6B7280", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  realEstateBadge: { fontSize: 11, fontWeight: "700", backgroundColor: "#FBF3DC", color: "#8A6D14", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  caption: { fontSize: 14, color: "#1F2937", marginBottom: 6 },
  tags: { fontSize: 12, color: "#1B2A4A", marginBottom: 8 },
  mediaPlaceholder: { height: 200, backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center", borderRadius: 8, marginBottom: 10 },
  mediaPlaceholderText: { color: "#9CA3AF" },
  actionsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  reactionsRow: { flexDirection: "row", gap: 10 },
  reactionButton: { flexDirection: "row", alignItems: "center", gap: 2 },
  reactionEmoji: { fontSize: 16 },
  reactionCount: { fontSize: 11, color: "#6B7280" },
  commentsLink: { fontSize: 12, color: "#6B7280" },
  commentsSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  commentText: { fontSize: 13, marginBottom: 6, color: "#374151" },
  commentAuthor: { fontWeight: "700", color: "#1B2A4A" },
  commentInputRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  commentInput: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, fontSize: 13 },
  commentSend: { color: "#1B2A4A", fontWeight: "700", fontSize: 16, paddingHorizontal: 6, paddingTop: 4 },
});

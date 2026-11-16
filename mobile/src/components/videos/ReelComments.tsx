import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { addPostComment, deletePostComment, getPostComments, reportComment, type PostComment, type ReelPost } from "../../lib/api";
import { useI18n } from "../../i18n";

const MAX_COMMENT = 1000;

/** The comments on one video, with add, delete-your-own and report-someone-else's. */
export default function ReelComments({ post, loggedIn, onClose, onCountChange }: {
  post: ReelPost;
  loggedIn: boolean;
  onClose: () => void;
  onCountChange: (postId: string, count: number) => void;
}) {
  const { t } = useI18n();
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPostComments(post.id)
      .then((data) => { if (!cancelled) setComments(data); })
      .catch(() => { if (!cancelled) { setComments([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [post.id]);

  function setAndCount(next: PostComment[]) {
    setComments(next);
    onCountChange(post.id, next.length);
  }

  async function handleSend() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setFailed(false);
    try {
      const created = await addPostComment(post.id, body);
      setAndCount([...(comments ?? []), created]);
      setText("");
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(comment: PostComment) {
    try {
      await deletePostComment(comment.id);
      setAndCount((comments ?? []).filter((c) => c.id !== comment.id));
    } catch {
      setFailed(true);
    }
  }

  async function handleReport(comment: PostComment) {
    if (!(await SecureStore.getItemAsync("access_token"))) {
      Alert.alert(t("videos.signInToComment"));
      return;
    }
    try {
      await reportComment(comment.id);
      Alert.alert(t("videos.commentReported"));
    } catch {
      Alert.alert(t("videos.reportFailed"));
    }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TouchableOpacity style={styles.dismiss} onPress={onClose} accessibilityLabel={t("videos.close")} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{t("videos.commentsTitle", { count: comments?.length ?? post.comment_count })}</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel={t("videos.close")}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>

          {comments === null ? (
            <ActivityIndicator style={{ margin: 24 }} color="#1B2A4A" />
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(c) => String(c.id)}
              style={styles.list}
              ListEmptyComponent={<Text style={styles.empty}>{t("videos.noComments")}</Text>}
              renderItem={({ item }) => (
                <View style={styles.comment}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.author}>{item.author_name}</Text>
                    <Text style={styles.body}>{item.text}</Text>
                  </View>
                  {item.is_mine ? (
                    <TouchableOpacity onPress={() => handleDelete(item)}><Text style={styles.delete}>{t("videos.deleteComment")}</Text></TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={() => handleReport(item)}><Text style={styles.report}>{t("videos.reportComment")}</Text></TouchableOpacity>
                  )}
                </View>
              )}
            />
          )}

          {failed && <Text style={styles.error}>{t("common.actionFailedBody")}</Text>}

          {loggedIn ? (
            <View style={styles.composer}>
              <TextInput
                style={styles.input} value={text} onChangeText={setText} maxLength={MAX_COMMENT}
                placeholder={t("videos.commentPlaceholder")} returnKeyType="send" onSubmitEditing={handleSend}
              />
              <TouchableOpacity style={[styles.send, (!text.trim() || sending) && styles.sendOff]} onPress={handleSend} disabled={!text.trim() || sending}>
                <Text style={styles.sendText}>{t("videos.send")}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.signIn}>{t("videos.signInToComment")}</Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  dismiss: { flex: 1 },
  sheet: { maxHeight: "72%", minHeight: 280, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  title: { fontWeight: "800", color: "#1B2A4A", fontSize: 15 },
  close: { fontSize: 18, color: "#6B7280" },
  list: { paddingHorizontal: 16 },
  empty: { textAlign: "center", color: "#6B7280", paddingVertical: 28 },
  comment: { flexDirection: "row", gap: 10, paddingVertical: 10 },
  author: { fontWeight: "700", color: "#64748B", fontSize: 12 },
  body: { color: "#0F172A", fontSize: 14 },
  delete: { color: "#E11D48", fontSize: 12, fontWeight: "700" },
  report: { color: "#9CA3AF", fontSize: 12 },
  error: { color: "#E11D48", fontSize: 12, paddingHorizontal: 16, paddingBottom: 6 },
  composer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  input: { flex: 1, borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#F8FAFC" },
  send: { backgroundColor: "#1B2A4A", borderRadius: 20, paddingHorizontal: 16, justifyContent: "center" },
  sendOff: { opacity: 0.4 },
  sendText: { color: "#fff", fontWeight: "700" },
  signIn: { textAlign: "center", color: "#1B2A4A", fontWeight: "700", padding: 16 },
});

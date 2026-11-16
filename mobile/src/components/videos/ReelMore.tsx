import { useState } from "react";
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { deletePost, reportPost, type PostReportReason, type ReelPost } from "../../lib/api";
import { useI18n } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";

const REASONS: PostReportReason[] = ["INAPPROPRIATE_CONTENT", "SCAM_SUSPECTED", "HARASSMENT", "OTHER"];

/** Your own video: delete it. Someone else's: report it. */
export default function ReelMore({ post, loggedIn, onClose, onDeleted }: {
  post: ReelPost;
  loggedIn: boolean;
  onClose: () => void;
  onDeleted: (postId: string) => void;
}) {
  const { t } = useI18n();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);

  function confirmDelete() {
    Alert.alert(t("videos.delete"), t("videos.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("videos.delete"), style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await deletePost(post.id);
            onDeleted(post.id);
          } catch {
            setBusy(false);
            Alert.alert(t("videos.deleteFailed"));
          }
        },
      },
    ]);
  }

  async function report(reason: PostReportReason) {
    setBusy(true);
    try {
      await reportPost(post.id, reason);
      Alert.alert(t("videos.reported"));
      onClose();
    } catch {
      setBusy(false);
      Alert.alert(t("videos.reportFailed"));
    }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} onPress={onClose} accessibilityLabel={t("videos.close")} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{choosing ? t("videos.reportTitle") : t("videos.moreTitle")}</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel={t("videos.close")}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>

          {post.is_mine ? (
            <TouchableOpacity style={styles.danger} onPress={confirmDelete} disabled={busy}>
              <Text style={styles.dangerText}>{t("videos.delete")}</Text>
            </TouchableOpacity>
          ) : !loggedIn ? (
            <Text style={styles.note}>{t("videos.signInNeeded")}</Text>
          ) : choosing ? (
            REASONS.map((reason) => (
              <TouchableOpacity key={reason} style={styles.option} onPress={() => report(reason)} disabled={busy}>
                <Text style={styles.optionText}>{t(`videos.reason.${reason}` as MessageKey)}</Text>
              </TouchableOpacity>
            ))
          ) : (
            <TouchableOpacity style={styles.option} onPress={() => setChoosing(true)}>
              <Text style={styles.optionText}>{t("videos.report")}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { fontWeight: "800", color: "#1B2A4A", fontSize: 15, flex: 1 },
  close: { fontSize: 18, color: "#6B7280" },
  option: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  optionText: { color: "#0F172A", fontSize: 15, fontWeight: "600" },
  danger: { backgroundColor: "#FFF1F2", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  dangerText: { color: "#BE123C", fontWeight: "700", fontSize: 15 },
  note: { color: "#6B7280", paddingVertical: 12 },
});

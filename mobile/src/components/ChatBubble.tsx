import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { translateChatMessage, type ChatTranslation, type ConversationMessage } from "../lib/api";
import { useI18n } from "../i18n";

/** One chat message, with a "Translate" link (when the platform offers translation) that shows it in the reader's language. */
export default function ChatBubble({ message, conversationId, canTranslate }: { message: ConversationMessage; conversationId: string; canTranslate: boolean }) {
  const { t, language } = useI18n();
  const [result, setResult] = useState<ChatTranslation | null>(null);
  const [showing, setShowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function translate() {
    setBusy(true);
    setError("");
    try {
      setResult(await translateChatMessage(conversationId, message.id, language));
      setShowing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("chat.translateFailed"));
    } finally {
      setBusy(false);
    }
  }

  const sourceName = result?.source_language === "fr" ? t("chat.langFr") : result?.source_language === "en" ? t("chat.langEn") : t("chat.langOther");

  return (
    <View style={styles.bubble}>
      <Text style={styles.text}>{message.text}</Text>
      {showing && result && !result.same_language ? (
        <View style={styles.translation}>
          <Text style={styles.text}>{result.text}</Text>
          <Text style={styles.note}>{t("chat.translatedFrom", { language: sourceName })}</Text>
        </View>
      ) : null}
      {showing && result?.same_language ? <Text style={styles.note}>{t("chat.alreadyYours")}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {canTranslate && message.text.trim() ? (
        <TouchableOpacity onPress={result ? () => setShowing(!showing) : translate} disabled={busy} style={styles.linkButton}>
          <Text style={styles.link}>{busy ? t("chat.translating") : result ? (showing ? t("chat.hideTranslation") : t("chat.showTranslation")) : t("chat.translate")}</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.tick}>{message.tick_status.seen ? t("chat.seen") : message.tick_status.delivered ? t("chat.delivered") : t("chat.sent")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { backgroundColor: "#F3F4F6", borderRadius: 10, padding: 10, marginBottom: 8, alignSelf: "flex-start", maxWidth: "80%" },
  text: { fontSize: 14, color: "#1F2937" },
  translation: { borderTopWidth: 1, borderTopColor: "#D1D5DB", marginTop: 8, paddingTop: 8 },
  note: { fontSize: 11, color: "#6B7280", marginTop: 4 },
  error: { fontSize: 11, color: "#DC2626", marginTop: 4 },
  linkButton: { minHeight: 32, justifyContent: "center", alignSelf: "flex-start" },
  link: { fontSize: 12, fontWeight: "600", color: "#1B2A4A", textDecorationLine: "underline" },
  tick: { fontSize: 10, color: "#9CA3AF", marginTop: 2 },
});

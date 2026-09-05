import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  getConversationMessages, sendConversationMessage, markConversationSeen,
  sendTypingHeartbeat, getTypingStatus, ConversationMessage,
} from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Conversation">;

/**
 * The real message thread — including the same 'X is typing...'
 * indicator built on web (a heartbeat sent while composing, polled
 * every 2 seconds by the other participant). This is genuinely
 * polling, not push, since the backend is REST — the same honest
 * architecture note as web: a couple of seconds of latency, not
 * instant like a true WebSocket connection would be.
 */
export default function ConversationScreen({ route }: Props) {
  const { conversationId } = route.params;
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [typingUsernames, setTypingUsernames] = useState<string[]>([]);
  const lastHeartbeatRef = useRef<number>(0);

  useFocusEffect(
    useCallback(() => {
      getConversationMessages(conversationId).then(setMessages).catch(() => {});
      markConversationSeen(conversationId);
    }, [conversationId])
  );

  useEffect(() => {
    const interval = setInterval(() => {
      getTypingStatus(conversationId).then((data) => setTypingUsernames(data.typing_usernames));
    }, 2000);
    return () => clearInterval(interval);
  }, [conversationId]);

  function handleDraftChange(value: string) {
    setDraft(value);
    const now = Date.now();
    // Throttled to at most once every 3 seconds — the backend's own
    // 8-second heartbeat timeout gives plenty of margin, and sending
    // on every keystroke would be wasteful.
    if (now - lastHeartbeatRef.current > 3000) {
      lastHeartbeatRef.current = now;
      sendTypingHeartbeat(conversationId);
    }
  }

  async function handleSend() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      const message = await sendConversationMessage(conversationId, draft);
      setMessages((prev) => [...prev, message]);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{item.text}</Text>
            <Text style={styles.tickStatus}>{item.tick_status.seen ? "Seen" : item.tick_status.delivered ? "Delivered" : "Sent"}</Text>
          </View>
        )}
      />

      {typingUsernames.length > 0 && (
        <Text style={styles.typingIndicator}>{typingUsernames.join(", ")} is typing...</Text>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input} value={draft} onChangeText={handleDraftChange} placeholder="Type a message..."
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending}>
          <Text style={styles.sendButtonText}>→</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  list: { padding: 16 },
  bubble: { backgroundColor: "#F3F4F6", borderRadius: 10, padding: 10, marginBottom: 8, alignSelf: "flex-start", maxWidth: "80%" },
  bubbleText: { fontSize: 14, color: "#1F2937" },
  tickStatus: { fontSize: 10, color: "#9CA3AF", marginTop: 4 },
  typingIndicator: { fontSize: 12, color: "#6B7280", fontStyle: "italic", paddingHorizontal: 16, paddingBottom: 4 },
  inputRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#E5E7EB", padding: 10, gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  sendButton: { backgroundColor: "#1B2A4A", borderRadius: 20, width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  sendButtonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});

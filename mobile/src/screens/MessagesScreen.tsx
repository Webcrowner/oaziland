import { useState, useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { listConversations, ConversationSummary } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Messages">;

/**
 * A real gap this closes: send_message_now()/mark_message_seen() had
 * a real, tested API and a real web inbox, but no mobile UI at all —
 * a mobile user could contact a lister via WhatsApp but never see
 * any reply inside the app itself.
 */
export default function MessagesScreen({ navigation }: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  const load = useCallback(() => {
    SecureStore.getItemAsync("access_token").then(async (token) => {
      if (!token) {
        setStatus("signedOut");
        return;
      }
      try {
        const data = await listConversations();
        setConversations(data.results);
        setStatus("ready");
      } catch {
        setStatus("ready");
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (status === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.signInText}>Sign in to view your messages</Text>
        <TouchableOpacity style={styles.signInButton} onPress={() => navigation.navigate("Login")}>
          <Text style={styles.signInButtonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
  }

  return (
    <FlatList
      data={conversations}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No conversations yet — messages from contacting a listing will show up here.</Text>}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate("Conversation", { conversationId: item.id, participantNames: item.participant_usernames.join(", ") })}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.participantNames}>{item.participant_usernames.join(", ")}</Text>
            {item.unread_count > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
              </View>
            )}
          </View>
          {item.last_message ? <Text style={styles.lastMessage} numberOfLines={1}>{item.last_message.text}</Text> : null}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  signInText: { color: "#6B7280", fontSize: 14, marginBottom: 16, textAlign: "center" },
  signInButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
  signInButtonText: { color: "#fff", fontWeight: "700" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  participantNames: { fontSize: 14, fontWeight: "700", color: "#1B2A4A" },
  unreadBadge: { backgroundColor: "#C9A227", borderRadius: 10, minWidth: 20, height: 20, justifyContent: "center", alignItems: "center", paddingHorizontal: 6 },
  unreadBadgeText: { color: "#1B2A4A", fontSize: 11, fontWeight: "700" },
  lastMessage: { fontSize: 13, color: "#6B7280" },
});

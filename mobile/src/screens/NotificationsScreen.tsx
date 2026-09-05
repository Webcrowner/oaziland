import { useState, useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { listMyNotifications, markNotificationRead, markAllNotificationsRead, AppNotification } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;

/**
 * A real gap this closes: every notification (booking confirmed,
 * listing expiring, MFA code, etc.) gets sent via WhatsApp/SMS/email,
 * but there was no in-app way to see notification history at all —
 * on web OR mobile. Mirrors the real web page exactly: tap any
 * notification to mark it read, mark-all-read, real unread styling.
 */
export default function NotificationsScreen({ navigation }: Props) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  const load = useCallback(() => {
    SecureStore.getItemAsync("access_token").then(async (token) => {
      if (!token) {
        setStatus("signedOut");
        return;
      }
      try {
        const data = await listMyNotifications();
        setNotifications(data.results);
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

  async function handleMarkRead(id: string) {
    await markNotificationRead(id);
    load();
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    load();
  }

  if (status === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.signInText}>Sign in to see your notifications</Text>
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
    <View style={styles.container}>
      {notifications.some((n) => !n.read_at) && (
        <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAllRow}>
          <Text style={styles.markAllText}>Mark all as read</Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>You have no notifications yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.read_at && styles.cardUnread]}
            onPress={() => handleMarkRead(item.id)}
          >
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.message}>{item.message}</Text>
            <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  signInText: { color: "#6B7280", fontSize: 14, marginBottom: 16, textAlign: "center" },
  signInButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
  signInButtonText: { color: "#fff", fontWeight: "700" },
  markAllRow: { paddingHorizontal: 16, paddingTop: 12 },
  markAllText: { color: "#1B2A4A", fontSize: 13, textDecorationLine: "underline" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  cardUnread: { backgroundColor: "#FBF3DC", borderColor: "#C9A227" },
  title: { fontSize: 14, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  message: { fontSize: 13, color: "#374151", marginBottom: 6 },
  date: { fontSize: 11, color: "#9CA3AF" },
});

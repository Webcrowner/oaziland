import { useState, useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { CommonActions, useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { listMyNotifications, markNotificationRead, markAllNotificationsRead, AppNotification } from "../lib/api";
import { notificationRoute } from "../lib/notificationLinks";

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;

/**
 * Notification history: tap one to mark it read and, when it points at an order, offer, listing or ride, open it.
 * Also has mark-all-read and real unread styling.
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

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    load();
  }

  // A tap marks the notification read and, when it points at something, opens it.
  async function handlePress(item: AppNotification) {
    const route = notificationRoute(item.target);
    const marking = item.read_at ? Promise.resolve() : markNotificationRead(item.id).catch(() => {});
    if (route) {
      setNotifications((prev) => prev.map((n) => (n.id === item.id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)));
      navigation.dispatch(CommonActions.navigate(route.name, route.params));
      return;
    }
    await marking;
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
        renderItem={({ item }) => {
          const tappable = notificationRoute(item.target) !== null;
          return (
            <TouchableOpacity
              style={[styles.card, !item.read_at && styles.cardUnread]}
              onPress={() => handlePress(item)}
              accessibilityRole="button"
              accessibilityHint={tappable ? "Opens the related page" : undefined}
            >
              <View style={styles.cardText}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.message}>{item.message}</Text>
                <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
              {tappable && <Text style={styles.chevron}>›</Text>}
            </TouchableOpacity>
          );
        }}
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
  card: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, backgroundColor: "#fff", borderRadius: 8, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  cardText: { flex: 1 },
  chevron: { fontSize: 26, color: "#9CA3AF", lineHeight: 28 },
  cardUnread: { backgroundColor: "#FBF3DC", borderColor: "#C9A227" },
  title: { fontSize: 14, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  message: { fontSize: 13, color: "#374151", marginBottom: 6 },
  date: { fontSize: 11, color: "#9CA3AF" },
});

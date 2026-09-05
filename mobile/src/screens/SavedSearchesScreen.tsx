import { useState, useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { listSavedSearches, deleteSavedSearch, SavedSearch } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "SavedSearches">;

/**
 * A real gap this closes: get_or_create/creating a saved search had
 * an API, and a web page, but no mobile UI. Mirrors the web page:
 * view and delete saved searches, real last-notified timestamps.
 */
export default function SavedSearchesScreen({ navigation }: Props) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  const load = useCallback(() => {
    SecureStore.getItemAsync("access_token").then(async (token) => {
      if (!token) {
        setStatus("signedOut");
        return;
      }
      try {
        const data = await listSavedSearches();
        setSearches(data.results);
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

  async function handleDelete(id: string) {
    await deleteSavedSearch(id);
    load();
  }

  if (status === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.signInText}>Sign in to manage your saved searches</Text>
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
      data={searches}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>You haven't saved any searches yet. Save one from the search results screen.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardText}>
            <Text style={styles.name}>{item.name || "Saved Search"}</Text>
            <Text style={styles.meta}>
              {item.last_notified_at ? `Last notified: ${new Date(item.last_notified_at).toLocaleDateString()}` : "No matches yet"}
            </Text>
          </View>
          <TouchableOpacity onPress={() => handleDelete(item.id)}>
            <Text style={styles.delete}>Delete</Text>
          </TouchableOpacity>
        </View>
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
  card: { backgroundColor: "#fff", borderRadius: 8, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardText: { flex: 1 },
  name: { fontSize: 14, fontWeight: "700", color: "#1B2A4A" },
  meta: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  delete: { color: "#DC2626", fontSize: 13, fontWeight: "600" },
});

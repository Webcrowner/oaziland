import { useState, useEffect } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { listAgents, type AgentDirectoryEntry } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Agents">;

/** Agents directory — mobile parity with the web app's /agents page. */
export default function AgentsScreen({ navigation }: Props) {
  const [agents, setAgents] = useState<AgentDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listAgents().then((data) => setAgents(data.results)).catch(() => setAgents([])).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={agents}
      keyExtractor={(item) => item.user_id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No agents listed yet.</Text>}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("AgentProfile", { agentId: item.user_id })}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{item.full_name.charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.full_name}</Text>
            {item.agency_name ? <Text style={styles.agency}>{item.agency_name}</Text> : null}
            <View style={styles.metaRow}>
              <Text style={styles.meta}>{item.active_listing_count} listing{item.active_listing_count === 1 ? "" : "s"}</Text>
              {item.is_kyc_verified && <Text style={styles.verified}>✓ Verified</Text>}
            </View>
            {item.average_rating ? <Text style={styles.rating}>★ {item.average_rating} ({item.rating_count})</Text> : null}
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center", marginRight: 12 },
  avatarText: { fontSize: 16, fontWeight: "700", color: "#1B2A4A" },
  name: { fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  agency: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  metaRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  meta: { fontSize: 12, color: "#6B7280" },
  verified: { fontSize: 12, color: "#16A34A", fontWeight: "600" },
  rating: { fontSize: 13, color: "#C9A227", fontWeight: "700", marginTop: 4 },
});

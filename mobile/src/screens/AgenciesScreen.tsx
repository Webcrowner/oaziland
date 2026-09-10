import { useState, useEffect } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { listAgencies, type AgencyDirectoryEntry } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Agencies">;

/** Agencies directory — mobile parity with the web app's /agencies page. */
export default function AgenciesScreen({ navigation }: Props) {
  const [agencies, setAgencies] = useState<AgencyDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listAgencies().then((data) => setAgencies(data.results)).catch(() => setAgencies([])).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={agencies}
      keyExtractor={(item) => item.agency_id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No agencies listed yet.</Text>}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("AgencyProfile", { agencyId: item.agency_id })}>
          <Text style={styles.name}>{item.agency_name}</Text>
          <Text style={styles.reg}>{item.registration_number}</Text>
          <Text style={styles.meta}>{item.agent_count} agent{item.agent_count === 1 ? "" : "s"}</Text>
          {item.average_rating ? <Text style={styles.rating}>★ {item.average_rating} ({item.rating_count})</Text> : null}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  name: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginBottom: 2 },
  reg: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  meta: { fontSize: 13, color: "#374151" },
  rating: { fontSize: 13, color: "#C9A227", fontWeight: "700", marginTop: 4 },
});

import { useState, useEffect } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { listWantedListings, WantedListing } from "../lib/api";

const CATEGORY_LABELS: Record<string, string> = {
  ROOM_RENTAL: "Room for Rent",
  STORE: "Store",
  WAREHOUSE: "Warehouse",
  BUSINESS: "Business (Going Concern)",
  BUSINESS_AREA: "Business Area/Commercial Space",
};

export default function WantedBoardScreen() {
  const [items, setItems] = useState<WantedListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listWantedListings()
      .then((data) => setItems(data.results))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No open requests right now.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.categoryBadge}>{CATEGORY_LABELS[item.category] || item.category}</Text>
            {item.quarter_name ? <Text style={styles.quarter}>{item.quarter_name}</Text> : null}
          </View>
          <Text style={styles.notes}>{item.notes}</Text>
          <View style={styles.metaRow}>
            {item.max_budget_xaf ? <Text style={styles.meta}>Budget: up to {Number(item.max_budget_xaf).toLocaleString()} XAF</Text> : null}
            {item.min_size_sqm ? <Text style={styles.meta}>At least {item.min_size_sqm} m²</Text> : null}
          </View>
          <Text style={styles.postedOn}>Posted {new Date(item.created_at).toLocaleDateString()}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 10, marginBottom: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  categoryBadge: { fontSize: 11, fontWeight: "700", color: "#fff", backgroundColor: "#1B2A4A", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  quarter: { fontSize: 12, color: "#6B7280" },
  notes: { fontSize: 14, color: "#374151", marginBottom: 8 },
  metaRow: { flexDirection: "row", gap: 16, marginBottom: 6 },
  meta: { fontSize: 12, color: "#6B7280" },
  postedOn: { fontSize: 11, color: "#9CA3AF" },
});

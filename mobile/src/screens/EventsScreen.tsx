import { useState, useEffect } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { searchVenues, Venue } from "../lib/api";

export default function EventsScreen() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    searchVenues()
      .then((data) => setVenues(data.results))
      .catch(() => setVenues([]))
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
      data={venues}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No verified venues are listed yet.</Text>}
      renderItem={({ item }) => {
        const cheapestSpace = item.spaces.length
          ? item.spaces.reduce((min, s) => (Number(s.base_price_per_hour_xaf) < Number(min.base_price_per_hour_xaf) ? s : min))
          : null;
        return (
          <View style={styles.card}>
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>No photo yet</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.location}>{item.quarter_name}</Text>
              <Text style={styles.spaceCount}>{item.spaces.length} space{item.spaces.length === 1 ? "" : "s"} available</Text>
              {item.spaces[0] ? (
                <View style={styles.capacityRow}>
                  {item.spaces[0].capacity_theatre ? <Text style={styles.capacity}>Theatre: {item.spaces[0].capacity_theatre}</Text> : null}
                  {item.spaces[0].capacity_banquet ? <Text style={styles.capacity}>Banquet: {item.spaces[0].capacity_banquet}</Text> : null}
                </View>
              ) : null}
              {cheapestSpace ? (
                <Text style={styles.price}>{Number(cheapestSpace.base_price_per_hour_xaf).toLocaleString()} XAF <Text style={styles.perHour}>/ hour</Text></Text>
              ) : null}
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 10, marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  imagePlaceholder: { height: 140, backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  imagePlaceholderText: { color: "#4B5563" },
  cardBody: { padding: 12 },
  location: { fontSize: 14, color: "#6B7280", marginBottom: 4 },
  spaceCount: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  capacityRow: { flexDirection: "row", gap: 12, marginBottom: 6 },
  capacity: { fontSize: 12, color: "#6B7280" },
  price: { fontSize: 18, fontWeight: "bold", color: "#1B2A4A" },
  perHour: { fontSize: 13, fontWeight: "normal", color: "#6B7280" },
});

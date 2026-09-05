import { useState, useEffect } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { searchGuestHouses, GuestHouse } from "../lib/api";

export default function GuestHousesScreen() {
  const [guestHouses, setGuestHouses] = useState<GuestHouse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    searchGuestHouses()
      .then((data) => setGuestHouses(data.results))
      .catch(() => setGuestHouses([]))
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
      data={guestHouses}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No guest houses are listed yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>No photo yet</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.location}>{item.quarter_name}</Text>
            {item.is_coastal_leisure ? <Text style={styles.badge}>COASTAL LEISURE</Text> : null}
          </View>
        </View>
      )}
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
  location: { fontSize: 14, color: "#6B7280", marginBottom: 6 },
  badge: { fontSize: 11, fontWeight: "700", color: "#fff", backgroundColor: "#1B2A4A", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, alignSelf: "flex-start" },
});

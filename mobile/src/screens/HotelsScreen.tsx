import { useState, useEffect } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { searchHotels, Hotel } from "../lib/api";

export default function HotelsScreen() {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    searchHotels()
      .then((data) => setHotels(data.results))
      .catch(() => setHotels([]))
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
      data={hotels}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No verified hotels are listed yet.</Text>}
      renderItem={({ item }) => {
        const cheapestRoom = item.room_types.length
          ? item.room_types.reduce((min, r) => (Number(r.base_rate_xaf) < Number(min.base_rate_xaf) ? r : min))
          : null;
        return (
          <View style={styles.card}>
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>No photo yet</Text>
            </View>
            <View style={styles.cardBody}>
              {item.name ? <Text style={styles.hotelName}>{item.name}</Text> : null}
              <Text style={styles.location}>{item.quarter_name}</Text>
              {item.star_rating ? <Text style={styles.stars}>{"★".repeat(item.star_rating)}</Text> : null}
              <Text style={styles.roomCount}>{item.room_types.length} room type{item.room_types.length === 1 ? "" : "s"} available</Text>
              {cheapestRoom ? (
                <Text style={styles.price}>{Number(cheapestRoom.base_rate_xaf).toLocaleString()} XAF <Text style={styles.perNight}>/ night</Text></Text>
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
  hotelName: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginBottom: 2 },
  location: { fontSize: 14, color: "#6B7280", marginBottom: 4 },
  stars: { color: "#C9A227", fontSize: 14, marginBottom: 4 },
  roomCount: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  price: { fontSize: 18, fontWeight: "bold", color: "#1B2A4A" },
  perNight: { fontSize: 13, fontWeight: "normal", color: "#6B7280" },
});

import { useState, useEffect } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { searchStudentHostels, StudentHostel } from "../lib/api";

export default function StudentHostelsScreen() {
  const [hostels, setHostels] = useState<StudentHostel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    searchStudentHostels()
      .then((data) => setHostels(data.results))
      .catch(() => setHostels([]))
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
      data={hostels}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No student hostels are listed yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>No photo yet</Text>
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.location}>{item.quarter_name}</Text>
            <Text style={styles.unitCount}>{item.units.length} unit{item.units.length === 1 ? "" : "s"} available</Text>
            <View style={styles.unitTypeRow}>
              {item.units.slice(0, 3).map((unit) => (
                <Text key={unit.id} style={styles.unitTypeBadge}>{unit.unit_type}</Text>
              ))}
            </View>
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
  location: { fontSize: 14, color: "#6B7280", marginBottom: 4 },
  unitCount: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  unitTypeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  unitTypeBadge: { fontSize: 11, fontWeight: "700", color: "#1B2A4A", backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, textTransform: "uppercase" },
});

import { useState, useEffect } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { listServiceCategories, type ServiceCategory } from "../lib/api";

/** Partner Services directory — mobile parity with the web app's /services page. */
export default function ServicesScreen() {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listServiceCategories().then((data) => setCategories(data.results)).catch(() => setCategories([])).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={categories}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No partner services yet.</Text>}
      renderItem={({ item: category }) => (
        <View style={styles.categorySection}>
          <Text style={styles.categoryTitle}>{category.name}</Text>
          {category.offerings.map((offering) => (
            <View key={offering.id} style={styles.card}>
              <Text style={styles.offeringName}>{offering.name}</Text>
              {offering.description ? <Text style={styles.offeringDesc}>{offering.description}</Text> : null}
              <Text style={styles.price}>{offering.price_hint_xaf ? `From ${Number(offering.price_hint_xaf).toLocaleString()} XAF` : "Price on request"}</Text>
            </View>
          ))}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  categorySection: { marginBottom: 20 },
  categoryTitle: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginBottom: 10, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", paddingBottom: 6 },
  card: { backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 8 },
  offeringName: { fontSize: 14, fontWeight: "700", color: "#1B2A4A", marginBottom: 2 },
  offeringDesc: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  price: { fontSize: 13, fontWeight: "700", color: "#C9A227" },
});

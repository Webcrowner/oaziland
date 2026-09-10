import { useState, useEffect } from "react";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { listTestimonials, type Testimonial } from "../lib/api";

/**
 * Testimonials — mobile parity with the web app's /testimonials
 * page. Real reviews only, pulled from completed-booking-linked
 * Review records — never fabricated placeholder quotes.
 */
export default function TestimonialsScreen() {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listTestimonials().then((data) => setTestimonials(data.results)).catch(() => setTestimonials([])).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={testimonials}
      keyExtractor={(_, i) => String(i)}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No testimonials yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.stars}>{"★".repeat(item.score)}</Text>
          <Text style={styles.text}>&ldquo;{item.text}&rdquo;</Text>
          <Text style={styles.author}>{item.author_name}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, marginBottom: 14 },
  stars: { color: "#C9A227", fontSize: 14, marginBottom: 8 },
  text: { fontSize: 14, color: "#374151", fontStyle: "italic", marginBottom: 10 },
  author: { fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
});

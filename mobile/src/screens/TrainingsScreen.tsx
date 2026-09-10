import { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { listTrainings, enrollInTraining, type TrainingProgram } from "../lib/api";

/** Trainings — mobile parity with the web app's /trainings page. */
export default function TrainingsScreen() {
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolledIds, setEnrolledIds] = useState<string[]>([]);

  const load = useCallback(() => {
    listTrainings().then((data) => setPrograms(data.results)).catch(() => setPrograms([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleEnroll(id: string) {
    const res = await enrollInTraining(id);
    if (res.ok) setEnrolledIds((prev) => [...prev, id]);
  }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={programs}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No training programs available yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.provider}>{item.provider_name}</Text>
          <Text style={styles.description}>{item.description}</Text>
          <View style={styles.footerRow}>
            <Text style={styles.price}>{item.price_xaf ? `${Number(item.price_xaf).toLocaleString()} XAF` : "Free"}</Text>
            {item.issues_certification && <Text style={styles.cert}>🎓 Certificate</Text>}
          </View>
          {enrolledIds.includes(item.id) ? (
            <Text style={styles.enrolledText}>✓ Enrolled</Text>
          ) : (
            <TouchableOpacity style={styles.enrollButton} onPress={() => handleEnroll(item.id)}>
              <Text style={styles.enrollButtonText}>Enroll</Text>
            </TouchableOpacity>
          )}
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
  title: { fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  provider: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  description: { fontSize: 13, color: "#374151", marginBottom: 8 },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  price: { fontSize: 14, fontWeight: "700", color: "#1B2A4A" },
  cert: { fontSize: 12, color: "#C9A227" },
  enrollButton: { backgroundColor: "#C9A227", borderRadius: 6, paddingVertical: 10, alignItems: "center" },
  enrollButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  enrolledText: { color: "#16A34A", fontWeight: "700", fontSize: 13 },
});

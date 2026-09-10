import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { listJobPostings, applyToJob, type JobPosting } from "../lib/api";

const ROLE_LABELS: Record<string, string> = {
  PROPERTY_MANAGER: "Property Manager", AGENT: "Agent", HOSTEL_WARDEN: "Hostel Warden",
  MAINTENANCE_STAFF: "Maintenance Staff", DRIVER: "Driver", OTHER: "Other",
};

/** Careers — mobile parity with the web app's /careers page. */
export default function CareersScreen() {
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [coverMessage, setCoverMessage] = useState("");
  const [appliedIds, setAppliedIds] = useState<string[]>([]);

  const load = useCallback(() => {
    listJobPostings().then((data) => setJobs(data.results)).catch(() => setJobs([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleApply(id: string) {
    await applyToJob(id, coverMessage);
    setAppliedIds((prev) => [...prev, id]);
    setApplyingId(null);
    setCoverMessage("");
  }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={jobs}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No open positions right now.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.title}>{item.title}</Text>
            {item.salary_min_xaf && item.salary_max_xaf && (
              <Text style={styles.salary}>{Number(item.salary_min_xaf).toLocaleString()} – {Number(item.salary_max_xaf).toLocaleString()} XAF</Text>
            )}
          </View>
          <Text style={styles.meta}>{ROLE_LABELS[item.role_category] || item.role_category}{item.quarter_name ? ` · ${item.quarter_name}` : ""}</Text>
          <Text style={styles.description}>{item.description}</Text>

          {appliedIds.includes(item.id) ? (
            <Text style={styles.appliedText}>✓ Application submitted!</Text>
          ) : applyingId === item.id ? (
            <View>
              <TextInput style={styles.input} placeholder="A short message..." value={coverMessage} onChangeText={setCoverMessage} multiline numberOfLines={2} />
              <TouchableOpacity style={styles.submitButton} onPress={() => handleApply(item.id)}>
                <Text style={styles.submitButtonText}>Submit Application</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.applyButton} onPress={() => setApplyingId(item.id)}>
              <Text style={styles.applyButtonText}>Apply</Text>
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
  cardHeader: { marginBottom: 4 },
  title: { fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  salary: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginTop: 4 },
  meta: { fontSize: 11, color: "#6B7280", textTransform: "uppercase", fontWeight: "600", marginBottom: 8 },
  description: { fontSize: 13, color: "#374151", marginBottom: 12 },
  applyButton: { backgroundColor: "#C9A227", borderRadius: 6, paddingVertical: 10, alignItems: "center", alignSelf: "flex-start", paddingHorizontal: 20 },
  applyButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 6, padding: 8, fontSize: 13, marginBottom: 8, textAlignVertical: "top" },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 6, paddingVertical: 10, alignItems: "center" },
  submitButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  appliedText: { color: "#16A34A", fontWeight: "700", fontSize: 13 },
});

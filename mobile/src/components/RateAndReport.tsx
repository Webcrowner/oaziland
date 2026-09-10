import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { rateUser, fileReportAgainstUser } from "../lib/api";

const REPORT_REASONS = ["SCAM_SUSPECTED", "HARASSMENT", "MISLEADING_LISTING", "USER_BEHAVIOR", "OTHER"];

/**
 * Mobile parity with the web app's RateAndReport component, same
 * session. A real gap this closes: nothing on mobile ever let a
 * visitor rate or report an agent, landlord, or owner directly —
 * only content they'd posted could ever be flagged.
 */
export default function RateAndReport({ subjectUserId }: { subjectUserId: string }) {
  const [mode, setMode] = useState<"idle" | "reporting" | "rated" | "reported">("idle");
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  async function handleRate(score: number) {
    try {
      await rateUser(subjectUserId, score);
      setMode("rated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  async function handleReport() {
    try {
      await fileReportAgainstUser(subjectUserId, reason, notes);
      setMode("reported");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (mode === "rated") return <Text style={styles.successText}>✓ Thanks for your rating!</Text>;
  if (mode === "reported") return <Text style={styles.successText}>✓ Report submitted. Our team will review it.</Text>;

  if (mode === "reporting") {
    return (
      <View style={styles.reportCard}>
        <Text style={styles.reportTitle}>Report this person</Text>
        <View style={styles.reasonRow}>
          {REPORT_REASONS.map((r) => (
            <TouchableOpacity key={r} style={[styles.reasonChip, reason === r && styles.reasonChipActive]} onPress={() => setReason(r)}>
              <Text style={[styles.reasonChipText, reason === r && styles.reasonChipTextActive]}>{r.replace(/_/g, " ")}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={styles.notesInput} placeholder="Add details (optional)..." value={notes} onChangeText={setNotes} multiline numberOfLines={2} />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.reportButtonRow}>
          <TouchableOpacity style={styles.submitReportButton} onPress={handleReport}>
            <Text style={styles.submitReportButtonText}>Submit Report</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("idle")}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.starsRow}>
        <Text style={styles.rateLabel}>Rate this person:</Text>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity key={star} onPress={() => handleRate(star)}>
            <Text style={styles.star}>★</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={() => setMode("reporting")}>
        <Text style={styles.reportLink}>Report</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: 8 },
  starsRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  rateLabel: { fontSize: 12, color: "#6B7280", marginRight: 6 },
  star: { fontSize: 20, color: "#C9A227", marginRight: 2 },
  reportLink: { fontSize: 12, color: "#9CA3AF", textDecorationLine: "underline" },
  successText: { fontSize: 13, color: "#16A34A", marginTop: 8 },
  errorText: { fontSize: 12, color: "#DC2626", marginTop: 4 },
  reportCard: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 12, backgroundColor: "#fff", marginTop: 8 },
  reportTitle: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginBottom: 8 },
  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  reasonChip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  reasonChipActive: { backgroundColor: "#A8502E", borderColor: "#A8502E" },
  reasonChipText: { fontSize: 10, color: "#374151" },
  reasonChipTextActive: { color: "#fff", fontWeight: "700" },
  notesInput: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 6, padding: 8, fontSize: 13, marginBottom: 8, textAlignVertical: "top" },
  reportButtonRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  submitReportButton: { backgroundColor: "#A8502E", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  submitReportButtonText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  cancelText: { fontSize: 12, color: "#6B7280" },
});

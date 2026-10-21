import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { fileReportAgainstListing } from "../lib/api";

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: "SCAM_SUSPECTED", label: "Looks like a scam" },
  { value: "MISLEADING_LISTING", label: "Misleading or fake details" },
  { value: "INAPPROPRIATE_CONTENT", label: "Inappropriate content" },
  { value: "OTHER", label: "Other" },
];

/** Lets a signed-in user flag a marketplace listing for admin review. */
export default function ReportListingButton({ listingId }: { listingId: string }) {
  const [mode, setMode] = useState<"idle" | "form" | "done">("idle");
  const [reason, setReason] = useState(REPORT_REASONS[0].value);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await fileReportAgainstListing(listingId, reason, notes);
      setMode("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the report. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "done") return <Text style={styles.success}>✓ Report submitted. Our team will review the listing.</Text>;

  if (mode === "form") {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Report this listing</Text>
        <View style={styles.reasons}>
          {REPORT_REASONS.map((r) => (
            <TouchableOpacity key={r.value} style={[styles.chip, reason === r.value && styles.chipActive]} onPress={() => setReason(r.value)}>
              <Text style={[styles.chipText, reason === r.value && styles.chipTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={styles.notes} placeholder="What is wrong with it? (optional)" value={notes} onChangeText={setNotes} multiline numberOfLines={2} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.submit} onPress={submit} disabled={busy}>
            <Text style={styles.submitText}>{busy ? "Sending..." : "Submit report"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("idle")}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={() => setMode("form")}>
      <Text style={styles.link}>Report this listing</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  link: { fontSize: 12, color: "#9CA3AF", textDecorationLine: "underline", marginTop: 8 },
  success: { fontSize: 13, color: "#16A34A", marginTop: 8 },
  card: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 12, backgroundColor: "#fff", marginTop: 8 },
  title: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginBottom: 8 },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  chipActive: { backgroundColor: "#A8502E", borderColor: "#A8502E" },
  chipText: { fontSize: 11, color: "#374151" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  notes: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 6, padding: 8, fontSize: 13, marginBottom: 8, textAlignVertical: "top" },
  error: { fontSize: 12, color: "#DC2626", marginBottom: 6 },
  buttons: { flexDirection: "row", alignItems: "center", gap: 12 },
  submit: { backgroundColor: "#A8502E", borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  cancel: { fontSize: 12, color: "#6B7280" },
});

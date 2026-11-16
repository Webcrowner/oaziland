import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { reportRideIssue, RIDE_ISSUE_CATEGORIES, type RideIssueCategory } from "../lib/api";
import { useI18n } from "../i18n";

const MIN_LENGTH = 10;
const MAX_LENGTH = 1000;

/** "Report a problem" on a trip: the report goes to the Oaziland team, who follow up by notification. */
export default function RideIssueReport({ rideId, isDriver }: { rideId: string; isDriver: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<RideIssueCategory | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // A rider doesn't report their own behaviour, and a driver doesn't report their own.
  const categories = RIDE_ISSUE_CATEGORIES.filter((c) => c !== (isDriver ? "DRIVER_BEHAVIOUR" : "RIDER_BEHAVIOUR"));
  const canSend = Boolean(category) && description.trim().length >= MIN_LENGTH && !busy;

  async function send() {
    if (!category || !canSend) return;
    setBusy(true);
    setError("");
    try {
      await reportRideIssue(rideId, { category, description: description.trim() });
      setSent(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.actionFailedBody"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return <Text style={styles.sent}>{t("issue.sent")}</Text>;
  }

  if (!open) {
    return (
      <TouchableOpacity onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={styles.link}>{t("issue.open")}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t("issue.title")}</Text>
      <Text style={styles.hint}>{t("issue.hint")}</Text>
      <Text style={styles.label}>{t("issue.categoryLabel")}</Text>
      <View style={styles.chips}>
        {categories.map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.chip, category === value && styles.chipActive]}
            onPress={() => setCategory(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: category === value }}
          >
            <Text style={[styles.chipText, category === value && styles.chipTextActive]}>{t(`issue.${value}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.label}>{t("issue.descriptionLabel")}</Text>
      <TextInput
        style={styles.input}
        placeholder={t("issue.descriptionPlaceholder")}
        value={description}
        onChangeText={setDescription}
        maxLength={MAX_LENGTH}
        multiline
      />
      <Text style={styles.counter}>{description.length}/{MAX_LENGTH}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <TouchableOpacity style={[styles.send, !canSend && styles.disabled]} onPress={send} disabled={!canSend}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>{t("issue.send")}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)} disabled={busy}>
          <Text style={styles.cancelText}>{t("common.cancel")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { fontSize: 12, color: "#6B7280", fontWeight: "600", textDecorationLine: "underline", marginTop: 8 },
  sent: { fontSize: 12, color: "#166534", backgroundColor: "#F0FDF4", borderRadius: 8, padding: 8, marginTop: 8 },
  box: { marginTop: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  title: { fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
  hint: { fontSize: 11, color: "#6B7280", marginTop: 2, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: "700", color: "#6B7280", textTransform: "uppercase", marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  chipActive: { borderColor: "#1B2A4A", backgroundColor: "#1B2A4A" },
  chipText: { fontSize: 12, color: "#374151" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", borderRadius: 8, padding: 8, fontSize: 13, minHeight: 70, textAlignVertical: "top" },
  counter: { fontSize: 10, color: "#9CA3AF", textAlign: "right", marginTop: 2, marginBottom: 6 },
  error: { fontSize: 12, color: "#B91C1C", backgroundColor: "#FEF2F2", borderRadius: 8, padding: 8, marginBottom: 8 },
  row: { flexDirection: "row", gap: 8 },
  send: { flex: 1, backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  sendText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
  cancel: { borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  cancelText: { color: "#374151", fontWeight: "600", fontSize: 13 },
});

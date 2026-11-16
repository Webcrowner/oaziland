import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

/** Inline "why?" picker shown before a rider cancels or a driver releases a ride; the other person is told the reason. */
export default function RideReasonPicker<R extends string>({
  title, reasons, labelPrefix, confirmLabel, onConfirm, onBack,
}: {
  title: string;
  reasons: readonly R[];
  labelPrefix: "cancelReason" | "releaseReason";
  confirmLabel: string;
  onConfirm: (reason: R, note: string) => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState<R | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await onConfirm(reason, note.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.chips}>
        {reasons.map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.chip, reason === value && styles.chipActive]}
            onPress={() => setReason(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: reason === value }}
          >
            <Text style={[styles.chipText, reason === value && styles.chipTextActive]}>{t(`${labelPrefix}.${value}` as MessageKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder={t("oazigo.reasonNotePlaceholder")}
        value={note}
        onChangeText={setNote}
        maxLength={300}
        multiline
      />
      <View style={styles.row}>
        <TouchableOpacity style={[styles.confirm, (!reason || busy) && styles.disabled]} onPress={confirm} disabled={!reason || busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.back} onPress={onBack} disabled={busy}>
          <Text style={styles.backText}>{t("oazigo.keepRide")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#FECACA", backgroundColor: "#FEF2F2" },
  title: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  chipActive: { borderColor: "#B91C1C", backgroundColor: "#B91C1C" },
  chipText: { fontSize: 12, color: "#374151" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", borderRadius: 8, padding: 8, fontSize: 13, minHeight: 44, marginBottom: 8 },
  row: { flexDirection: "row", gap: 8 },
  confirm: { flex: 1, backgroundColor: "#B91C1C", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  confirmText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
  back: { borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center" },
  backText: { color: "#374151", fontWeight: "600", fontSize: 13 },
});

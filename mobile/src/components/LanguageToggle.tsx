import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useI18n, type Language } from "../i18n";

const OPTIONS: { value: Language; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "fr", label: "FR" },
];

/** EN / FR switch. The choice is remembered on the device. */
export default function LanguageToggle() {
  const { language, setLanguage, t } = useI18n();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t("lang.label")}>
      {OPTIONS.map((o) => (
        <TouchableOpacity
          key={o.value}
          style={[styles.pill, language === o.value && styles.pillActive]}
          onPress={() => setLanguage(o.value)}
          accessibilityRole="radio"
          accessibilityState={{ selected: language === o.value }}
        >
          <Text style={[styles.text, language === o.value && styles.textActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 4, alignSelf: "flex-end" },
  pill: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "#fff" },
  pillActive: { backgroundColor: "#C9A227", borderColor: "#C9A227" },
  text: { fontSize: 12, fontWeight: "700", color: "#374151" },
  textActive: { color: "#1B2A4A" },
});

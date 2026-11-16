import { Text, TouchableOpacity, StyleSheet } from "react-native";
import { useI18n } from "../i18n";

/** "Did you mean X?" under a search box; tapping it searches for the suggestion. */
export default function DidYouMeanBanner({ suggestion, onPick }: { suggestion: string | null; onPick: (term: string) => void }) {
  const { t } = useI18n();
  if (!suggestion) return null;
  return (
    <TouchableOpacity style={styles.banner} onPress={() => onPick(suggestion)} accessibilityRole="button" accessibilityLabel={t("mkt.didYouMean.searchInstead", { term: suggestion })}>
      <Text style={styles.text}>{t("mkt.didYouMean.prefix")} <Text style={styles.term}>{suggestion}</Text>{t("mkt.didYouMean.suffix")}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: "#FFFBEB", borderColor: "#C9A227", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  text: { fontSize: 13, color: "#92400E" },
  term: { fontWeight: "700", textDecorationLine: "underline", color: "#1B2A4A" },
});

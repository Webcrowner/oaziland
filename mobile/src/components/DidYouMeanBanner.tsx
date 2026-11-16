import { Text, TouchableOpacity, StyleSheet } from "react-native";

/** "Did you mean X?" under a search box; tapping it searches for the suggestion. */
export default function DidYouMeanBanner({ suggestion, onPick }: { suggestion: string | null; onPick: (term: string) => void }) {
  if (!suggestion) return null;
  return (
    <TouchableOpacity style={styles.banner} onPress={() => onPick(suggestion)} accessibilityRole="button" accessibilityLabel={`Search for ${suggestion} instead`}>
      <Text style={styles.text}>Did you mean <Text style={styles.term}>{suggestion}</Text>?</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: "#FFFBEB", borderColor: "#C9A227", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  text: { fontSize: 13, color: "#92400E" },
  term: { fontWeight: "700", textDecorationLine: "underline", color: "#1B2A4A" },
});

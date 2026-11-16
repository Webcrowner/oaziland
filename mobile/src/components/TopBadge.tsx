import { Text, StyleSheet } from "react-native";

/** Marks a listing the seller paid to boost to the top of its category. */
export default function TopBadge() {
  return <Text style={styles.badge}>TOP</Text>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", backgroundColor: "#C9A227", color: "#1B2A4A", fontSize: 11, fontWeight: "700", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4, overflow: "hidden" },
});

import { Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";

export default function LoadMoreButton({ onPress, loading }: { onPress: () => void; loading: boolean }) {
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.text}>Load more</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 16 },
  text: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
});

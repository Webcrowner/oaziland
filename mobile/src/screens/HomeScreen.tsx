import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { listQuarters, Quarter } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

/** Home screen — Page 1's mobile equivalent. On a phone, the search
 * bar IS the whole first screen — there's no room for a mega-menu or
 * trust-badge strip, matching exactly the "mobile prioritizes the
 * search bar above everything else" responsive principle from the
 * web app, just expressed as native screen real estate instead of
 * CSS breakpoints. */
export default function HomeScreen({ navigation }: Props) {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listQuarters()
      .then(setQuarters)
      .catch(() => setQuarters([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Find your next home in Cameroon</Text>
      <Text style={styles.subtitle}>Verified listings, secure Mobile Money payments.</Text>

      {loading ? (
        <ActivityIndicator color="#1B2A4A" style={{ marginTop: 20 }} />
      ) : (
        <View style={styles.chipRow}>
          {quarters.slice(0, 6).map((q) => (
            <TouchableOpacity
              key={q.id}
              style={[styles.chip, selectedQuarter === q.id && styles.chipSelected]}
              onPress={() => setSelectedQuarter(q.id)}
            >
              <Text style={[styles.chipText, selectedQuarter === q.id && styles.chipTextSelected]}>{q.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={styles.searchButton}
        onPress={() => navigation.navigate("Search", { quarterId: selectedQuarter })}
      >
        <Text style={styles.searchButtonText}>Search Properties</Text>
      </TouchableOpacity>

      <View style={styles.linksRow}>
        <TouchableOpacity onPress={() => navigation.navigate("Login")}>
          <Text style={styles.link}>Sign In</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate("Register")}>
          <Text style={styles.link}>Register</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate("ListProperty")}>
          <Text style={styles.link}>List a Property</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20 },
  title: { fontSize: 26, fontWeight: "bold", color: "#1B2A4A", marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#6B7280", marginBottom: 20 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  chip: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  chipSelected: { backgroundColor: "#1B2A4A" },
  chipText: { color: "#1B2A4A", fontSize: 13 },
  chipTextSelected: { color: "#fff" },
  searchButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  searchButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
  linksRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 24 },
  link: { color: "#1B2A4A", fontWeight: "600" },
});

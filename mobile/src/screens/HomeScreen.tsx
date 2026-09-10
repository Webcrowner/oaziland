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
  const [listingType, setListingType] = useState<"RENT" | "SALE">("RENT");
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

      {/* Rent vs Sale — the platform's two most basic categories,
          given their own explicit toggle, matching the exact same
          redesign made on web earlier this session. */}
      <View style={styles.listingTypeRow}>
        {(["RENT", "SALE"] as const).map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.listingTypeToggle, listingType === type && styles.listingTypeToggleSelected]}
            onPress={() => setListingType(type)}
          >
            <Text style={[styles.listingTypeText, listingType === type && styles.listingTypeTextSelected]}>
              {type === "RENT" ? "For Rent" : "For Sale"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
        onPress={() => navigation.navigate("Search", { quarterId: selectedQuarter, listingType })}
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

      <Text style={styles.exploreTitle}>Explore More on Oaziland</Text>
      <View style={styles.exploreGrid}>
        {([
          { label: "Hotels", screen: "Hotels" as const },
          { label: "Student Hostels", screen: "StudentHostels" as const },
          { label: "Event Venues", screen: "Events" as const },
          { label: "Guest Houses", screen: "GuestHouses" as const },
          { label: "Looking For...", screen: "WantedBoard" as const },
          { label: "Marketplace", screen: "Marketplace" as const },
          { label: "Taskln Service", screen: "TasklnService" as const },
          { label: "Saved Listings", screen: "Favorites" as const },
          { label: "Notifications", screen: "Notifications" as const },
          { label: "Saved Searches", screen: "SavedSearches" as const },
          { label: "Compare Properties", screen: "Comparison" as const },
          { label: "Messages", screen: "Messages" as const },
          { label: "Social Feed", screen: "Feed" as const },
          { label: "My Dashboard", screen: "AgentDashboard" as const },
          { label: "Property Management", screen: "PropertyManagement" as const },
          { label: "Agents", screen: "Agents" as const },
          { label: "Agencies", screen: "Agencies" as const },
          { label: "Careers", screen: "Careers" as const },
          { label: "Testimonials", screen: "Testimonials" as const },
          { label: "Admin Console", screen: "AdminConsole" as const },
        ]).map((category) => (
          <TouchableOpacity key={category.screen} style={styles.exploreCard} onPress={() => navigation.navigate(category.screen)}>
            <Text style={styles.exploreCardText}>{category.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20 },
  title: { fontSize: 26, fontWeight: "bold", color: "#1B2A4A", marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#6B7280", marginBottom: 20 },
  listingTypeRow: { flexDirection: "row", borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#D1D5DB", marginBottom: 16 },
  listingTypeToggle: { flex: 1, paddingVertical: 12, alignItems: "center" },
  listingTypeToggleSelected: { backgroundColor: "#1B2A4A" },
  listingTypeText: { color: "#374151", fontWeight: "600" },
  listingTypeTextSelected: { color: "#fff" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  chip: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  chipSelected: { backgroundColor: "#1B2A4A" },
  chipText: { color: "#1B2A4A", fontSize: 13 },
  chipTextSelected: { color: "#fff" },
  searchButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  searchButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
  linksRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 24 },
  link: { color: "#1B2A4A", fontWeight: "600" },
  exploreTitle: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginTop: 32, marginBottom: 12 },
  exploreGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  exploreCard: { width: "47%", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingVertical: 16, alignItems: "center" },
  exploreCardText: { color: "#1B2A4A", fontWeight: "600", fontSize: 13 },
});

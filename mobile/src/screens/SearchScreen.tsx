import { useState, useEffect } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { searchListings, createSavedSearch, Listing } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Search">;

const FINISH_LABELS: Record<string, string> = { MODERN: "Modern", STANDARD: "Standard" };

/** Mirrors the exact web fix: a direct owner renting is a landlord;
 * the same person selling outright is an owner. */
function listerRoleLabel(role: string, listingType: string): string {
  if (role === "OWNER") return listingType === "SALE" ? "Owner" : "Landlord";
  if (role === "AGENT") return "Agent";
  if (role === "AGENCY") return "Agency";
  return "Owner";
}

export default function SearchScreen({ route, navigation }: Props) {
  const { quarterId, propertyType, finishLevel, listingType } = route.params || {};
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSearch, setSavingSearch] = useState(false);

  useEffect(() => {
    searchListings({ quarter: quarterId, property_type: propertyType, finish_level: finishLevel, listing_type: listingType })
      .then((data) => setListings(data.results))
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, [quarterId, propertyType, finishLevel, listingType]);

  async function handleSaveSearch() {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      navigation.navigate("Login");
      return;
    }
    const filters: Record<string, string> = {};
    if (quarterId) filters.quarter_id = quarterId;
    if (propertyType) filters.property_type = propertyType;
    if (finishLevel) filters.finish_level = finishLevel;
    if (listingType) filters.listing_type = listingType;

    setSavingSearch(true);
    try {
      await createSavedSearch("", filters);
      Alert.alert("Saved", "You'll be notified when a new listing matches this search.");
    } catch {
      Alert.alert("Could not save", "Please try again.");
    } finally {
      setSavingSearch(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
  }

  return (
    <FlatList
      data={listings}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <TouchableOpacity onPress={handleSaveSearch} disabled={savingSearch} style={styles.saveSearchButton}>
          <Text style={styles.saveSearchText}>{savingSearch ? "Saving..." : "Save This Search"}</Text>
        </TouchableOpacity>
      }
      ListEmptyComponent={<Text style={styles.empty}>No listings match your search yet.</Text>}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate("ListingDetail", { listingId: item.id })}
        >
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>No photo yet</Text>
          </View>
          <View style={styles.cardBody}>
            <View style={styles.badgeRow}>
              <Text style={styles.badge}>{item.property_asset.type}</Text>
              {item.property_asset.finish_level ? (
                <Text style={styles.badgeGold}>{FINISH_LABELS[item.property_asset.finish_level]}</Text>
              ) : null}
              <Text style={[styles.listerBadge, item.lister_role === "OWNER" ? styles.listerBadgeOwner : styles.listerBadgeAgent]}>
                {listerRoleLabel(item.lister_role, item.listing_type)}
              </Text>
            </View>
            <Text style={styles.price}>{Number(item.price_xaf).toLocaleString()} XAF</Text>
            <Text style={styles.location}>{item.property_asset.quarter_name}</Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  saveSearchButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginBottom: 16 },
  saveSearchText: { color: "#1B2A4A", fontWeight: "600", fontSize: 13 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 10, marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  imagePlaceholder: { height: 140, backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  imagePlaceholderText: { color: "#4B5563" },
  cardBody: { padding: 12 },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
  badge: { fontSize: 11, fontWeight: "700", color: "#1B2A4A", backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, textTransform: "uppercase" },
  badgeGold: { fontSize: 11, fontWeight: "700", color: "#fff", backgroundColor: "#1B2A4A", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, textTransform: "uppercase" },
  listerBadge: { fontSize: 11, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, textTransform: "uppercase" },
  listerBadgeOwner: { color: "#15803D", backgroundColor: "#DCFCE7" },
  listerBadgeAgent: { color: "#8A6D14", backgroundColor: "#F3EBD0" },
  price: { fontSize: 18, fontWeight: "bold", color: "#1B2A4A" },
  location: { fontSize: 13, color: "#6B7280", marginTop: 2 },
});

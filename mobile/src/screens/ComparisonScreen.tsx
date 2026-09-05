import { useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getMyComparison, getListing, Listing } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Comparison">;

/**
 * A real gap this closes: create_or_update_comparison() had real
 * logic (2-4 listing limit enforced) and a web page, but no mobile
 * UI. Renders the real side-by-side comparison — a simple stacked
 * layout rather than a wide table, since a phone screen has no room
 * for a real side-by-side table the way the web page does.
 */
export default function ComparisonScreen({ navigation }: Props) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      SecureStore.getItemAsync("access_token").then(async (token) => {
        if (!token) {
          if (isActive) setStatus("signedOut");
          return;
        }
        try {
          const comparison = await getMyComparison();
          if (!comparison) {
            if (isActive) setStatus("ready");
            return;
          }
          const fetched = await Promise.all(comparison.listing_ids.map((id) => getListing(id).catch(() => null)));
          if (isActive) {
            setListings(fetched.filter((l): l is Listing => l !== null));
            setStatus("ready");
          }
        } catch {
          if (isActive) setStatus("ready");
        }
      });
      return () => {
        isActive = false;
      };
    }, [])
  );

  if (status === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.signInText}>Sign in to compare properties</Text>
        <TouchableOpacity style={styles.signInButton} onPress={() => navigation.navigate("Login")}>
          <Text style={styles.signInButtonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
  }

  if (listings.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.empty}>Add 2 to 4 listings to compare from any listing screen.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.list}>
      {listings.map((listing) => (
        <TouchableOpacity
          key={listing.id}
          style={styles.card}
          onPress={() => navigation.navigate("ListingDetail", { listingId: listing.id })}
        >
          <Text style={styles.price}>{Number(listing.price_xaf).toLocaleString()} XAF</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Location</Text>
            <Text style={styles.value}>{listing.property_asset.quarter_name}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Type</Text>
            <Text style={styles.value}>{listing.property_asset.type}</Text>
          </View>
          {listing.property_asset.size_sqm ? (
            <View style={styles.row}>
              <Text style={styles.label}>Size</Text>
              <Text style={styles.value}>{listing.property_asset.size_sqm} m²</Text>
            </View>
          ) : null}
          {listing.property_asset.finish_level ? (
            <View style={styles.row}>
              <Text style={styles.label}>Finish</Text>
              <Text style={styles.value}>{listing.property_asset.finish_level}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  signInText: { color: "#6B7280", fontSize: 14, marginBottom: 16, textAlign: "center" },
  signInButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
  signInButtonText: { color: "#fff", fontWeight: "700" },
  empty: { textAlign: "center", color: "#6B7280" },
  list: { padding: 16 },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  price: { fontSize: 20, fontWeight: "bold", color: "#1B2A4A", marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  label: { fontSize: 13, color: "#6B7280" },
  value: { fontSize: 13, color: "#1B2A4A", fontWeight: "600" },
});

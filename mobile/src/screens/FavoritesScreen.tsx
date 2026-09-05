import { useState, useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getMyFavorites, getListing, Listing } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Favorites">;

const FINISH_LABELS: Record<string, string> = { MODERN: "Modern", STANDARD: "Standard" };

/**
 * A real gap this closes: Favorites had zero mobile UI despite the
 * feature and its API existing. Re-fetches every favorited listing's
 * CURRENT detail (never stale cached data), the same design already
 * used on web. useFocusEffect (not a plain useEffect) so returning
 * from unfavoriting a listing on its detail screen refreshes this
 * list automatically.
 */
export default function FavoritesScreen({ navigation }: Props) {
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
          const data = await getMyFavorites();
          const fetched = await Promise.all(data.listing_ids.map((id) => getListing(id).catch(() => null)));
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
        <Text style={styles.signInText}>Sign in to see your saved listings</Text>
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

  return (
    <FlatList
      data={listings}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>You haven't saved any listings yet.</Text>}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("ListingDetail", { listingId: item.id })}>
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>No photo yet</Text>
          </View>
          <View style={styles.cardBody}>
            <View style={styles.badgeRow}>
              <Text style={styles.badge}>{item.property_asset.type}</Text>
              {item.property_asset.finish_level ? (
                <Text style={styles.badgeGold}>{FINISH_LABELS[item.property_asset.finish_level]}</Text>
              ) : null}
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
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  signInText: { color: "#6B7280", fontSize: 14, marginBottom: 16, textAlign: "center" },
  signInButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
  signInButtonText: { color: "#fff", fontWeight: "700" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 10, marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  imagePlaceholder: { height: 140, backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  imagePlaceholderText: { color: "#4B5563" },
  cardBody: { padding: 12 },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
  badge: { fontSize: 11, fontWeight: "700", color: "#1B2A4A", backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, textTransform: "uppercase" },
  badgeGold: { fontSize: 11, fontWeight: "700", color: "#fff", backgroundColor: "#1B2A4A", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, textTransform: "uppercase" },
  price: { fontSize: 18, fontWeight: "bold", color: "#1B2A4A" },
  location: { fontSize: 13, color: "#6B7280", marginTop: 2 },
});

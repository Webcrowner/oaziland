import { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Linking, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getListing, Listing, contactListing, getMyFavorites, toggleFavoriteListing } from "../lib/api";
import RateAndReport from "../components/RateAndReport";

type Props = NativeStackScreenProps<RootStackParamList, "ListingDetail">;

const FINISH_LABELS: Record<string, string> = { MODERN: "Modern", STANDARD: "Standard (Not Modern)" };

/** A direct owner renting property out is a landlord; a direct owner
 * selling it outright is an owner — mirrors the exact distinction
 * built on web this session. */
function listerRoleLabel(role: string, listingType: string): string {
  if (role === "OWNER") return listingType === "SALE" ? "Owner" : "Landlord";
  if (role === "AGENT") return "Agent";
  if (role === "AGENCY") return "Agency";
  return "Owner";
}

export default function ListingDetailScreen({ route, navigation }: Props) {
  const { listingId } = route.params;
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFavorited, setIsFavorited] = useState(false);
  const [contacting, setContacting] = useState(false);
  const [isStagedForCompare, setIsStagedForCompare] = useState(false);

  const COMPARE_STAGING_KEY = "oaziland_comparison_staging";

  useEffect(() => {
    getListing(listingId)
      .then(setListing)
      .catch(() => setListing(null))
      .finally(() => setLoading(false));
  }, [listingId]);

  useEffect(() => {
    SecureStore.getItemAsync(COMPARE_STAGING_KEY).then((raw) => {
      const staged: string[] = raw ? JSON.parse(raw) : [];
      setIsStagedForCompare(staged.includes(listingId));
    });
  }, [listingId]);

  const handleToggleCompare = useCallback(async () => {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      navigation.navigate("Login");
      return;
    }
    const raw = await SecureStore.getItemAsync(COMPARE_STAGING_KEY);
    const staged: string[] = raw ? JSON.parse(raw) : [];
    const next = isStagedForCompare ? staged.filter((id) => id !== listingId) : [...staged, listingId].slice(-4);

    if (next.length >= 2) {
      try {
        const { setMyComparison } = await import("../lib/api");
        await setMyComparison(next);
        await SecureStore.setItemAsync(COMPARE_STAGING_KEY, JSON.stringify(next));
        setIsStagedForCompare(!isStagedForCompare);
      } catch {
        Alert.alert("Could not save", "Please try again.");
      }
    } else {
      await SecureStore.setItemAsync(COMPARE_STAGING_KEY, JSON.stringify(next));
      setIsStagedForCompare(!isStagedForCompare);
    }
  }, [listingId, isStagedForCompare, navigation]);

  useEffect(() => {
    SecureStore.getItemAsync("access_token").then((token) => {
      if (!token) return;
      getMyFavorites()
        .then((data) => setIsFavorited(data.listing_ids.includes(listingId)))
        .catch(() => {});
    });
  }, [listingId]);

  const handleToggleFavorite = useCallback(async () => {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      navigation.navigate("Login");
      return;
    }
    try {
      const result = await toggleFavoriteListing(listingId);
      setIsFavorited(result.is_favorited);
    } catch {
      Alert.alert("Could not save", "Please try again.");
    }
  }, [listingId, navigation]);

  const handleContact = useCallback(async () => {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      navigation.navigate("Login");
      return;
    }
    setContacting(true);
    try {
      const result = await contactListing(listingId);
      await Linking.openURL(result.deep_link);
    } catch {
      Alert.alert("Could not start the conversation", "Please try again.");
    } finally {
      setContacting(false);
    }
  }, [listingId, navigation]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={styles.centered}>
        <Text>This listing could not be found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.imagePlaceholder}>
        <Text style={styles.imagePlaceholderText}>No photo yet</Text>
        <TouchableOpacity style={styles.favoriteButton} onPress={handleToggleFavorite}>
          <Text style={styles.favoriteButtonText}>{isFavorited ? "★" : "☆"}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>{listing.property_asset.type}</Text>
          {listing.property_asset.finish_level ? (
            <Text style={styles.badgeGold}>{FINISH_LABELS[listing.property_asset.finish_level]}</Text>
          ) : null}
        </View>

        <Text style={styles.price}>{Number(listing.price_xaf).toLocaleString()} XAF</Text>
        <Text style={styles.location}>📍 {listing.property_asset.quarter_name}</Text>

        {listing.property_asset.description ? (
          <Text style={styles.description}>{listing.property_asset.description}</Text>
        ) : null}

        {/* Who posted this — the same visual distinction built on web:
            a real person should be able to tell, at a glance, whether
            they're dealing with the owner directly, an agent, or an agency. */}
        <View style={[styles.listerCard, listing.lister_role === "OWNER" ? styles.listerCardOwner : styles.listerCardAgent]}>
          <Text style={[styles.listerRoleLabel, listing.lister_role === "OWNER" ? styles.listerRoleLabelOwner : styles.listerRoleLabelAgent]}>
            {listerRoleLabel(listing.lister_role, listing.listing_type)}
          </Text>
          <Text style={styles.listerName}>{listing.lister_display_name}</Text>
          {listing.lister_agency_name ? <Text style={styles.listerAgency}>{listing.lister_agency_name}</Text> : null}
          <RateAndReport subjectUserId={listing.lister_id} />
        </View>

        {listing.property_asset.size_sqm ? (
          <Text style={styles.detail}>Size: {listing.property_asset.size_sqm} m²</Text>
        ) : null}
        <Text style={styles.detail}>Listing Type: {listing.listing_type}</Text>

        <TouchableOpacity style={styles.whatsappButton} onPress={handleContact} disabled={contacting}>
          {contacting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.whatsappButtonText}>Contact on WhatsApp</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.compareButton} onPress={handleToggleCompare}>
          <Text style={styles.compareButtonText}>{isStagedForCompare ? "Remove from Compare" : "Add to Compare"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  imagePlaceholder: { height: 220, backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  imagePlaceholderText: { color: "#4B5563" },
  favoriteButton: { position: "absolute", top: 12, right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.9)", justifyContent: "center", alignItems: "center" },
  favoriteButtonText: { fontSize: 18, color: "#C9A227" },
  content: { padding: 20 },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 10 },
  badge: { fontSize: 12, fontWeight: "700", color: "#fff", backgroundColor: "#1B2A4A", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, textTransform: "uppercase" },
  badgeGold: { fontSize: 12, fontWeight: "700", color: "#1B2A4A", backgroundColor: "#F3EBD0", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, textTransform: "uppercase" },
  price: { fontSize: 28, fontWeight: "bold", color: "#1B2A4A" },
  location: { fontSize: 15, color: "#6B7280", marginBottom: 8 },
  description: { fontSize: 14, color: "#374151", marginBottom: 16, lineHeight: 20 },
  listerCard: { borderRadius: 8, padding: 12, marginBottom: 16 },
  listerCardOwner: { backgroundColor: "#F0FDF4" },
  listerCardAgent: { backgroundColor: "#FBF3DC" },
  listerRoleLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginBottom: 4 },
  listerRoleLabelOwner: { color: "#15803D", backgroundColor: "#DCFCE7" },
  listerRoleLabelAgent: { color: "#8A6D14", backgroundColor: "#F3EBD0" },
  listerName: { fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  listerAgency: { fontSize: 13, color: "#6B7280" },
  detail: { fontSize: 14, color: "#374151", marginBottom: 4 },
  whatsappButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  whatsappButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
  compareButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 10, marginBottom: 30 },
  compareButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 14 },
});

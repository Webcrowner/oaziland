import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Linking } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getListing, Listing } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "ListingDetail">;

const FINISH_LABELS: Record<string, string> = { MODERN: "Modern", STANDARD: "Standard (Not Modern)" };

export default function ListingDetailScreen({ route }: Props) {
  const { listingId } = route.params;
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getListing(listingId)
      .then(setListing)
      .catch(() => setListing(null))
      .finally(() => setLoading(false));
  }, [listingId]);

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
      </View>

      <View style={styles.content}>
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>{listing.property_asset.type}</Text>
          {listing.property_asset.finish_level ? (
            <Text style={styles.badgeGold}>{FINISH_LABELS[listing.property_asset.finish_level]}</Text>
          ) : null}
        </View>

        <Text style={styles.price}>{Number(listing.price_xaf).toLocaleString()} XAF</Text>
        <Text style={styles.location}>{listing.property_asset.quarter_name}</Text>

        {listing.property_asset.size_sqm ? (
          <Text style={styles.detail}>Size: {listing.property_asset.size_sqm} m²</Text>
        ) : null}
        <Text style={styles.detail}>Listing Type: {listing.listing_type}</Text>

        <TouchableOpacity
          style={styles.whatsappButton}
          onPress={() => Linking.openURL("https://wa.me/?text=Hi, I'm interested in this listing on Oaziland")}
        >
          <Text style={styles.whatsappButtonText}>Contact on WhatsApp</Text>
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
  content: { padding: 20 },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 10 },
  badge: { fontSize: 12, fontWeight: "700", color: "#fff", backgroundColor: "#1B2A4A", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, textTransform: "uppercase" },
  badgeGold: { fontSize: 12, fontWeight: "700", color: "#1B2A4A", backgroundColor: "#F3EBD0", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, textTransform: "uppercase" },
  price: { fontSize: 28, fontWeight: "bold", color: "#1B2A4A" },
  location: { fontSize: 15, color: "#6B7280", marginBottom: 16 },
  detail: { fontSize: 14, color: "#374151", marginBottom: 4 },
  whatsappButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  whatsappButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
});

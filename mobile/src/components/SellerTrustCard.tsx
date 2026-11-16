import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getMarketplaceSeller, type MarketplaceSellerSummary } from "../lib/api";
import { lastSeenLabel, memberSinceLabel, replyTimeLabel } from "../lib/sellerTrust";

/** Who you are dealing with: verified ID, rating, member since, items sold, other listings and how quickly they reply. The name opens their shop. */
export default function SellerTrustCard({ sellerId, sellerName }: { sellerId: string; sellerName: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [seller, setSeller] = useState<MarketplaceSellerSummary | null>(null);

  useEffect(() => {
    getMarketplaceSeller(sellerId).then(setSeller).catch(() => {});
  }, [sellerId]);

  return (
    <View style={styles.card}>
      <View style={styles.nameRow}>
        <TouchableOpacity onPress={() => navigation.navigate("MarketplaceShop", { userId: sellerId })} accessibilityRole="link" accessibilityLabel="Open this seller's shop">
          <Text style={styles.name}>{seller?.name ?? sellerName}</Text>
        </TouchableOpacity>
        {seller?.id_verified && <Text style={styles.verified}>✓ ID verified</Text>}
      </View>
      {seller && (
        <View>
          <Text style={styles.line}>
            {seller.rating_avg != null ? `★ ${seller.rating_avg} (${seller.rating_count} ${seller.rating_count === 1 ? "rating" : "ratings"})` : "No ratings yet"}
          </Text>
          <Text style={styles.line}>{memberSinceLabel(seller.member_since)}</Text>
          <Text style={styles.line}>{seller.items_sold} sold · {seller.active_listings} active {seller.active_listings === 1 ? "listing" : "listings"}</Text>
          {seller.reply_time_hours != null && seller.reply_rate_pct != null && (
            <Text style={styles.line}>⏱ {replyTimeLabel(seller.reply_time_hours)} · {seller.reply_rate_pct}% reply rate</Text>
          )}
          {seller.last_seen_at ? <Text style={styles.line}>{lastSeenLabel(seller.last_seen_at)}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#F3F4F6", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  name: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", textDecorationLine: "underline" },
  verified: { fontSize: 11, fontWeight: "700", color: "#166534", backgroundColor: "#DCFCE7", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  line: { fontSize: 13, color: "#4B5563", marginTop: 2 },
});

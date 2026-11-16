import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getMarketplaceSeller, type MarketplaceSellerSummary } from "../lib/api";
import { lastSeenLabel, memberSinceLabel, replyTimeLabel } from "../lib/sellerTrust";
import { useI18n } from "../i18n";

/** Who you are dealing with: verified ID, rating, member since, items sold, other listings and how quickly they reply. The name opens their shop. */
export default function SellerTrustCard({ sellerId, sellerName }: { sellerId: string; sellerName: string }) {
  const { t, locale } = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [seller, setSeller] = useState<MarketplaceSellerSummary | null>(null);

  useEffect(() => {
    getMarketplaceSeller(sellerId).then(setSeller).catch(() => {});
  }, [sellerId]);

  return (
    <View style={styles.card}>
      <View style={styles.nameRow}>
        <TouchableOpacity onPress={() => navigation.navigate("MarketplaceShop", { userId: sellerId })} accessibilityRole="link" accessibilityLabel={t("mkt.trust.openShop")}>
          <Text style={styles.name}>{seller?.name ?? sellerName}</Text>
        </TouchableOpacity>
        {seller?.id_verified && <Text style={styles.verified}>✓ {t("mkt.trust.idVerified")}</Text>}
      </View>
      {seller && (
        <View>
          <Text style={styles.line}>
            {seller.rating_avg != null ? `★ ${seller.rating_avg} (${t(seller.rating_count === 1 ? "mkt.trust.ratingOne" : "mkt.trust.ratingMany", { count: seller.rating_count })})` : t("mkt.trust.noRatings")}
          </Text>
          <Text style={styles.line}>{memberSinceLabel(seller.member_since, t, locale)}</Text>
          <Text style={styles.line}>{t(seller.active_listings === 1 ? "mkt.trust.soldOne" : "mkt.trust.soldMany", { sold: seller.items_sold, active: seller.active_listings })}</Text>
          {seller.reply_time_hours != null && seller.reply_rate_pct != null && (
            <Text style={styles.line}>⏱ {replyTimeLabel(seller.reply_time_hours, t)} · {t("mkt.trust.replyRate", { pct: seller.reply_rate_pct })}</Text>
          )}
          {seller.last_seen_at ? <Text style={styles.line}>{lastSeenLabel(seller.last_seen_at, new Date(), t)}</Text> : null}
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

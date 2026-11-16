import { View, Text, TouchableOpacity, Image, StyleSheet } from "react-native";
import type { MarketplaceFeedListing } from "../lib/api";
import { useI18n } from "../i18n";
import SalePrice from "./SalePrice";
import TopBadge from "./TopBadge";

/** One row of the cross-category feed (flash deals, a shop's listings). */
export default function MarketplaceListingCard({ listing, onPress }: { listing: MarketplaceFeedListing; onPress: () => void }) {
  const { t } = useI18n();
  const photo = listing.media.find((m) => m.media_type === "PHOTO");
  const isGoods = listing.category === "goods";
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      {photo ? <Image source={{ uri: photo.file_url }} style={styles.image} /> : (
        <View style={[styles.image, styles.placeholder]}><Text style={styles.placeholderText}>{t("mkt.noPhotoYet")}</Text></View>
      )}
      <View style={styles.body}>
        {listing.is_boosted && <TopBadge />}
        <Text style={styles.title}>{listing.title}</Text>
        {isGoods && listing.quantity !== undefined && <Text style={styles.stock}>{listing.quantity > 0 ? t("mkt.inStockCount", { count: listing.quantity }) : t("mkt.soldOut")}</Text>}
        {listing.quarter_name ? <Text style={styles.stock}>📍 {listing.quarter_name}</Text> : null}
        <SalePrice listing={listing} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 10, marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  image: { height: 140, width: "100%" },
  placeholder: { backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  placeholderText: { color: "#4B5563" },
  body: { padding: 12 },
  title: { fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  stock: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
});

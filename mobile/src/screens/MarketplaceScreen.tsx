import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import MarketplaceUnifiedSearch from "../components/MarketplaceUnifiedSearch";
import { getMarketplaceCart } from "../lib/api";
import { cartBadge } from "../lib/marketplaceCart";
import { useI18n } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "Marketplace">;

const CATEGORIES = [
  { key: "Warehouses" as const, icon: "🏭" },
  { key: "Stores" as const, icon: "🏬" },
  { key: "Businesses" as const, icon: "💼" },
  { key: "Cars" as const, icon: "🚗" },
  { key: "Goods" as const, icon: "📦" },
];

/**
 * The Marketplace hub — mobile parity with the web app's /marketplace
 * page, built this same session. Real navigation into each of the
 * four real categories, plus Rides shown separately since it's a
 * transaction, not a listing category.
 */
export default function MarketplaceScreen({ navigation }: Props) {
  const { t } = useI18n();
  const [cartCount, setCartCount] = useState(0);

  const loadCartCount = useCallback(async () => {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      setCartCount(0);
      return;
    }
    getMarketplaceCart().then((cart) => setCartCount(cart.item_count)).catch(() => {});
  }, []);

  useEffect(() => {
    loadCartCount();
    return navigation.addListener("focus", loadCartCount);
  }, [loadCartCount, navigation]);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <MarketplaceUnifiedSearch onOpen={(result) => navigation.navigate("MarketplaceListingDetail", { category: result.category, listingId: result.id })} />

      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.quickButton} onPress={() => navigation.navigate("MarketplaceCart")} accessibilityLabel={t("mkt.hub.cartLabel", { count: cartCount })}>
          <Text style={styles.quickText}>🛒 {t("mkt.hub.cart")}</Text>
          {cartCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{cartBadge(cartCount)}</Text></View>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickButton} onPress={() => navigation.navigate("MarketplaceDeals")}>
          <Text style={styles.quickText}>⚡ {t("mkt.hub.deals")}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>{t("mkt.hub.subtitle")}</Text>

      {CATEGORIES.map((category) => (
        <TouchableOpacity key={category.key} style={styles.card} onPress={() => navigation.navigate(category.key)}>
          <Text style={styles.icon}>{category.icon}</Text>
          <View style={styles.cardText}>
            <Text style={styles.cardLabel}>{t(`mkt.hub.cat${category.key}`)}</Text>
            <Text style={styles.cardDesc}>{t(`mkt.hub.cat${category.key}Desc`)}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MarketplaceOrders")}>
        <Text style={styles.cardLabel}>{t("mkt.hub.orders")}</Text>
        <Text style={styles.cardDesc}>{t("mkt.hub.ordersDesc")}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MarketplaceOffers")}>
        <Text style={styles.cardLabel}>{t("mkt.hub.offers")}</Text>
        <Text style={styles.cardDesc}>{t("mkt.hub.offersDesc")}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MarketplaceSellerDashboard")}>
        <Text style={styles.cardLabel}>{t("mkt.hub.dashboard")}</Text>
        <Text style={styles.cardDesc}>{t("mkt.hub.dashboardDesc")}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MyMarketplaceListings")}>
        <Text style={styles.cardLabel}>{t("mkt.hub.listings")}</Text>
        <Text style={styles.cardDesc}>{t("mkt.hub.listingsDesc")}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MarketplaceShopSettings")}>
        <Text style={styles.cardLabel}>{t("mkt.hub.shop")}</Text>
        <Text style={styles.cardDesc}>{t("mkt.hub.shopDesc")}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ridesCard} onPress={() => navigation.navigate("OaziGo")}>
        <Text style={styles.ridesTitle}>OaziGo</Text>
        <Text style={styles.ridesDesc}>{t("mkt.hub.ridesDesc")}</Text>
        <Text style={styles.ridesCta}>{t("mkt.hub.ridesCta")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  quickRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  quickButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1B2A4A", borderRadius: 10, paddingVertical: 12 },
  quickText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  badge: { backgroundColor: "#C9A227", borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#1B2A4A", fontSize: 11, fontWeight: "700" },
  subtitle: { color: "#6B7280", marginBottom: 20, fontSize: 14 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, marginBottom: 12 },
  icon: { fontSize: 28, marginRight: 14 },
  cardText: { flex: 1 },
  cardLabel: { fontSize: 16, fontWeight: "700", color: "#1B2A4A" },
  cardDesc: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  ridesCard: { backgroundColor: "#1B2A4A", borderRadius: 10, padding: 20, marginTop: 12 },
  ordersCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#C9A227", padding: 16, marginBottom: 12 },
  ridesTitle: { fontSize: 18, fontWeight: "700", color: "#fff", marginBottom: 6 },
  ridesDesc: { fontSize: 13, color: "#D1D5DB", marginBottom: 12 },
  ridesCta: { fontSize: 14, fontWeight: "700", color: "#C9A227" },
});

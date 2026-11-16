import { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import MarketplaceUnifiedSearch from "../components/MarketplaceUnifiedSearch";
import { getMarketplaceCart } from "../lib/api";
import { cartBadge } from "../lib/marketplaceCart";

type Props = NativeStackScreenProps<RootStackParamList, "Marketplace">;

const CATEGORIES = [
  { key: "Warehouses" as const, icon: "🏭", label: "Warehouses", desc: "Storage and industrial space for rent or sale." },
  { key: "Stores" as const, icon: "🏬", label: "Stores", desc: "Retail shopfronts, for rent or sale." },
  { key: "Businesses" as const, icon: "💼", label: "Businesses", desc: "Going concerns for sale." },
  { key: "Cars" as const, icon: "🚗", label: "Cars", desc: "Vehicles for sale or rent." },
  { key: "Goods" as const, icon: "📦", label: "Goods", desc: "New and used items, with pickup or delivery." },
];

/**
 * The Marketplace hub — mobile parity with the web app's /marketplace
 * page, built this same session. Real navigation into each of the
 * four real categories, plus Rides shown separately since it's a
 * transaction, not a listing category.
 */
export default function MarketplaceScreen({ navigation }: Props) {
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
        <TouchableOpacity style={styles.quickButton} onPress={() => navigation.navigate("MarketplaceCart")} accessibilityLabel={`Cart, ${cartCount} items`}>
          <Text style={styles.quickText}>🛒 Cart</Text>
          {cartCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{cartBadge(cartCount)}</Text></View>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickButton} onPress={() => navigation.navigate("MarketplaceDeals")}>
          <Text style={styles.quickText}>⚡ Flash deals</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>Beyond real estate: browse or list warehouses, stores, businesses and cars, and browse goods.</Text>

      {CATEGORIES.map((category) => (
        <TouchableOpacity key={category.key} style={styles.card} onPress={() => navigation.navigate(category.key)}>
          <Text style={styles.icon}>{category.icon}</Text>
          <View style={styles.cardText}>
            <Text style={styles.cardLabel}>{category.label}</Text>
            <Text style={styles.cardDesc}>{category.desc}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MarketplaceOrders")}>
        <Text style={styles.cardLabel}>My orders</Text>
        <Text style={styles.cardDesc}>Track what you bought or sold, confirm receipt, or report a problem.</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MarketplaceOffers")}>
        <Text style={styles.cardLabel}>My offers</Text>
        <Text style={styles.cardDesc}>Offers you made, and offers on your listings to accept, decline or counter.</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MarketplaceSellerDashboard")}>
        <Text style={styles.cardLabel}>Seller dashboard</Text>
        <Text style={styles.cardDesc}>Your sales, fees, earnings, payouts and top listings, with a CSV export.</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MyMarketplaceListings")}>
        <Text style={styles.cardLabel}>My listings</Text>
        <Text style={styles.cardDesc}>Edit, boost, renew, pause, mark as sold or delete what you have posted.</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ordersCard} onPress={() => navigation.navigate("MarketplaceShopSettings")}>
        <Text style={styles.cardLabel}>My shop</Text>
        <Text style={styles.cardDesc}>Your storefront, policies, vacation mode, discount codes and staff.</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.ridesCard} onPress={() => navigation.navigate("OaziGo")}>
        <Text style={styles.ridesTitle}>OaziGo</Text>
        <Text style={styles.ridesDesc}>Real rides for people, or moving building materials between properties — with a transparent fare and secure Mobile Money payment.</Text>
        <Text style={styles.ridesCta}>Open OaziGo →</Text>
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

import { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getMarketplaceCart, removeCartItem, setCartItem, type CartCheckoutResult, type MarketplaceCart } from "../lib/api";
import CartSellerGroup from "../components/CartSellerGroup";
import { cartLineKey, formatXaf } from "../lib/marketplaceCart";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceCart">;

/** Goods you plan to buy, grouped by seller; each seller is checked out with a single Mobile Money payment. */
export default function MarketplaceCartScreen({ navigation }: Props) {
  const [cart, setCart] = useState<MarketplaceCart | null>(null);
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      setState("signedOut");
      return;
    }
    try {
      setCart(await getMarketplaceCart());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your cart.");
    }
    setState("ready");
  }, []);

  useEffect(() => {
    load();
    return navigation.addListener("focus", load);
  }, [load, navigation]);

  async function change(key: string, action: () => Promise<MarketplaceCart>) {
    setBusyKey(key);
    setError("");
    try {
      setCart(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Please try again.");
    } finally {
      setBusyKey(null);
    }
  }

  function handlePaid(result: CartCheckoutResult) {
    const count = result.orders.length;
    Alert.alert(
      "Payment request sent",
      `Approve the Mobile Money prompt to pay ${formatXaf(result.total_xaf)}. ${count > 0 ? `${count} ${count === 1 ? "order is" : "orders are"} created` : "Your orders are created"} once it is confirmed, and each item is tracked and refundable separately.`,
      [{ text: "View my orders", onPress: () => navigation.navigate("MarketplaceOrders") }],
      { cancelable: false },
    );
    load();
  }

  if (state === "loading") return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;

  if (state === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Sign in to see your cart.</Text>
        <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("Login")}><Text style={styles.primaryText}>Sign In</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!cart || cart.groups.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>Your cart is empty.</Text>
          <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("Goods")}><Text style={styles.primaryText}>Browse goods</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("MarketplaceDeals")}><Text style={styles.link}>See flash deals</Text></TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.subtitle}>Items from different sellers are paid separately, one payment per seller.</Text>
          {cart.groups.map((group) => (
            <CartSellerGroup
              key={group.seller_id} group={group} busyKey={busyKey}
              onSetQuantity={(item, quantity) => change(cartLineKey(item), () => setCartItem(item.listing_id, quantity, item.variant_id))}
              onRemove={(item) => change(cartLineKey(item), () => removeCartItem(item.listing_id, item.variant_id))}
              onPaid={handlePaid}
              onOpenListing={(listingId) => navigation.navigate("MarketplaceListingDetail", { category: "goods", listingId })}
              onOpenShop={(userId) => navigation.navigate("MarketplaceShop", { userId })}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, flexGrow: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  muted: { color: "#6B7280", fontSize: 14, textAlign: "center", marginBottom: 12 },
  subtitle: { color: "#6B7280", fontSize: 13, marginBottom: 14 },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", marginBottom: 12 },
  primaryText: { color: "#1B2A4A", fontWeight: "700" },
  link: { color: "#1B2A4A", fontWeight: "600", textDecorationLine: "underline", fontSize: 13 },
});

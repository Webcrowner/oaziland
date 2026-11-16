import { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getMarketplaceCart, removeCartItem, setCartItem, type CartCheckoutResult, type MarketplaceCart } from "../lib/api";
import CartSellerGroup from "../components/CartSellerGroup";
import { cartLineKey, formatXaf } from "../lib/marketplaceCart";
import { useI18n } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceCart">;

/** Goods you plan to buy, grouped by seller; each seller is checked out with a single Mobile Money payment. */
export default function MarketplaceCartScreen({ navigation }: Props) {
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t("mkt.cart.loadFailed"));
    }
    setState("ready");
  }, [t]);

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
      setError(err instanceof Error ? err.message : t("common.actionFailedBody"));
    } finally {
      setBusyKey(null);
    }
  }

  function handlePaid(result: CartCheckoutResult) {
    const count = result.orders.length;
    const amount = formatXaf(result.total_xaf);
    Alert.alert(
      t("mkt.cart.paymentSentTitle"),
      count === 0 ? t("mkt.cart.paymentSentNone", { amount }) : count === 1 ? t("mkt.cart.paymentSentOne", { amount }) : t("mkt.cart.paymentSentMany", { amount, count }),
      [{ text: t("mkt.cart.viewOrders"), onPress: () => navigation.navigate("MarketplaceOrders") }],
      { cancelable: false },
    );
    load();
  }

  if (state === "loading") return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;

  if (state === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t("mkt.cart.signInPrompt")}</Text>
        <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("Login")}><Text style={styles.primaryText}>{t("common.signIn")}</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!cart || cart.groups.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>{t("mkt.cart.empty")}</Text>
          <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("Goods")}><Text style={styles.primaryText}>{t("mkt.cart.browseGoods")}</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("MarketplaceDeals")}><Text style={styles.link}>{t("mkt.cart.seeDeals")}</Text></TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.subtitle}>{t("mkt.cart.separatePayments")}</Text>
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

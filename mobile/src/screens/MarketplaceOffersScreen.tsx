import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  listMyMarketplaceOffers, marketplaceOfferAction,
  type MarketplaceOffer, type MarketplaceOfferActionName, type MarketplaceOfferStatus,
} from "../lib/api";
import { counterAmountError, offerActions, offerCurrentAmount, offerStatusLabel, parseAmount, type OfferRole } from "../lib/marketplaceOffers";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceOffers">;

const STATUS_COLORS: Record<MarketplaceOfferStatus, string> = {
  PENDING: "#C9A227", COUNTERED: "#C9A227", ACCEPTED: "#16A34A", PAID: "#16A34A", DECLINED: "#A8502E", WITHDRAWN: "#6B7280", EXPIRED: "#6B7280",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function hint(offer: MarketplaceOffer, role: OfferRole): string {
  switch (offer.status) {
    case "PENDING":
      return offer.respond_by ? `${role === "selling" ? "Answer" : "The seller has"} by ${formatDate(offer.respond_by)} or it expires.` : "";
    case "COUNTERED":
      return role === "buying"
        ? `The seller would accept ${offerCurrentAmount(offer).toLocaleString()} XAF. Answer by ${offer.respond_by ? formatDate(offer.respond_by) : "the deadline"} or it expires.`
        : `You countered with ${offerCurrentAmount(offer).toLocaleString()} XAF. Waiting for the buyer.`;
    case "ACCEPTED":
      return role === "buying"
        ? `Pay ${offerCurrentAmount(offer).toLocaleString()} XAF by ${offer.pay_by ? formatDate(offer.pay_by) : "the deadline"}; the item is reserved for you until then.`
        : `The buyer has until ${offer.pay_by ? formatDate(offer.pay_by) : "the deadline"} to pay ${offerCurrentAmount(offer).toLocaleString()} XAF.`;
    case "PAID": return "The buyer paid. Follow the order under My orders.";
    default: return "";
  }
}

/** Offers on marketplace listings: the ones you made as a buyer and the ones you received as a seller. */
export default function MarketplaceOffersScreen({ navigation, route }: Props) {
  const [role, setRole] = useState<OfferRole>(route.params?.role ?? "buying");
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [countering, setCountering] = useState<string | null>(null);
  const [counterText, setCounterText] = useState("");

  const load = useCallback(async (which: OfferRole) => {
    try {
      setOffers((await listMyMarketplaceOffers(which)).results);
      setError("");
    } catch (err) {
      setOffers([]);
      setError(err instanceof Error ? err.message : "Could not load your offers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(role); }, [load, role]);

  // Opened from a notification that points at the other tab.
  const requestedRole = route.params?.role;
  useEffect(() => {
    if (requestedRole && requestedRole !== role) switchRole(requestedRole);
  }, [requestedRole]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(offerId: string, action: MarketplaceOfferActionName, amount?: number) {
    setError("");
    try {
      await marketplaceOfferAction(offerId, action, amount);
      setCountering(null);
      setCounterText("");
      await load(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Please try again.");
    }
  }

  function confirmThen(message: string, offerId: string, action: MarketplaceOfferActionName) {
    Alert.alert("Are you sure?", message, [
      { text: "No", style: "cancel" },
      { text: "Yes", onPress: () => run(offerId, action) },
    ]);
  }

  function sendCounter(offer: MarketplaceOffer) {
    const invalid = counterAmountError(counterText, Number(offer.amount_xaf), Number(offer.listing_price_xaf));
    if (invalid) {
      setError(invalid);
      return;
    }
    run(offer.id, "counter", parseAmount(counterText) ?? 0);
  }

  function switchRole(next: OfferRole) {
    setRole(next);
    setLoading(true);
    setError("");
    setCountering(null);
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(["buying", "selling"] as OfferRole[]).map((value) => (
          <TouchableOpacity key={value} style={[styles.tab, role === value && styles.tabActive]} onPress={() => switchRole(value)}>
            <Text style={[styles.tabText, role === value && styles.tabTextActive]}>{value === "buying" ? "Buying" : "Selling"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>
      ) : (
        <FlatList
          data={offers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.empty}>{role === "buying" ? "You have not made any offers yet." : "Nobody has made an offer on your listings yet."}</Text>
              <TouchableOpacity onPress={() => navigation.navigate("Marketplace")}><Text style={styles.link}>Browse the marketplace</Text></TouchableOpacity>
            </View>
          }
          renderItem={({ item: offer }) => {
            const actions = offerActions(offer.status, role);
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <TouchableOpacity style={styles.titleWrap} disabled={!offer.category} onPress={() => offer.category && navigation.navigate("MarketplaceListingDetail", { category: offer.category, listingId: offer.listing_id })}>
                    <Text style={styles.cardTitle}>{offer.listing_title}</Text>
                  </TouchableOpacity>
                  <View style={[styles.badge, { backgroundColor: STATUS_COLORS[offer.status] }]}><Text style={styles.badgeText}>{offerStatusLabel(offer.status, role)}</Text></View>
                </View>
                <Text style={styles.meta}>
                  Asking {Number(offer.listing_price_xaf).toLocaleString()} XAF · Offer {Number(offer.amount_xaf).toLocaleString()} XAF
                  {offer.counter_amount_xaf ? ` · Counter ${Number(offer.counter_amount_xaf).toLocaleString()} XAF` : ""}
                </Text>
                <Text style={styles.meta}>{role === "buying" ? `Seller: ${offer.seller_name}` : `Buyer: ${offer.buyer_name}`}</Text>
                {offer.message ? <Text style={styles.message}>“{offer.message}”</Text> : null}
                <Text style={styles.date}>{formatDate(offer.created_at)}</Text>
                {hint(offer, role) ? <Text style={styles.hint}>{hint(offer, role)}</Text> : null}

                {countering === offer.id ? (
                  <View>
                    <TextInput style={styles.input} placeholder="Your counter-offer (XAF)" value={counterText} onChangeText={setCounterText} keyboardType="number-pad" />
                    <View style={styles.actions}>
                      <TouchableOpacity style={[styles.primary, !counterText.trim() && styles.disabled]} disabled={!counterText.trim()} onPress={() => sendCounter(offer)}>
                        <Text style={styles.primaryText}>Send counter-offer</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setCountering(null)}><Text style={styles.secondary}>Close</Text></TouchableOpacity>
                    </View>
                  </View>
                ) : actions.length > 0 ? (
                  <View style={styles.actions}>
                    {actions.includes("accept") && (
                      <TouchableOpacity style={styles.primary} onPress={() => run(offer.id, "accept")}>
                        <Text style={styles.primaryText}>{role === "buying" ? "Accept counter" : "Accept"}</Text>
                      </TouchableOpacity>
                    )}
                    {actions.includes("pay") && offer.category !== "" && (
                      <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("MarketplaceListingDetail", { category: offer.category as Exclude<MarketplaceOffer["category"], "">, listingId: offer.listing_id })}>
                        <Text style={styles.primaryText}>Pay now</Text>
                      </TouchableOpacity>
                    )}
                    {actions.includes("counter") && (
                      <TouchableOpacity onPress={() => { setCountering(offer.id); setCounterText(""); setError(""); }}><Text style={styles.secondary}>Counter</Text></TouchableOpacity>
                    )}
                    {actions.includes("decline") && (
                      <TouchableOpacity onPress={() => confirmThen("Decline this offer?", offer.id, "decline")}><Text style={styles.danger}>Decline</Text></TouchableOpacity>
                    )}
                    {actions.includes("withdraw") && (
                      <TouchableOpacity onPress={() => confirmThen("Withdraw this offer?", offer.id, "withdraw")}><Text style={styles.danger}>Withdraw</Text></TouchableOpacity>
                    )}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  centered: { alignItems: "center", justifyContent: "center", paddingTop: 40 },
  tabs: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 8 },
  tab: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, backgroundColor: "#E5E7EB" },
  tabActive: { backgroundColor: "#1B2A4A" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  tabTextActive: { color: "#fff" },
  error: { color: "#DC2626", fontSize: 13, paddingHorizontal: 16, paddingBottom: 4 },
  list: { padding: 16, paddingTop: 8 },
  empty: { color: "#6B7280", marginBottom: 8 },
  link: { color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline" },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  titleWrap: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  meta: { fontSize: 13, color: "#4B5563" },
  message: { fontSize: 13, color: "#374151", fontStyle: "italic", marginTop: 4 },
  date: { fontSize: 11, color: "#9CA3AF", marginTop: 4, marginBottom: 8 },
  hint: { fontSize: 13, color: "#4B5563", marginBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  primaryText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
  secondary: { color: "#1B2A4A", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  danger: { color: "#B91C1C", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14 },
});

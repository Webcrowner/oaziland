import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  listMyMarketplaceOrders, marketplaceOrderAction,
  type MarketplaceOrderItem, type MarketplaceOrderStatus, type MarketplaceOrderActionName,
} from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceOrders">;
type Role = "buying" | "selling";

const STATUS_LABELS: Record<MarketplaceOrderStatus, string> = {
  PAID: "Paid, awaiting handover", HANDED_OVER: "Handed over", COMPLETED: "Completed", CANCELLED: "Cancelled and refunded", DISPUTED: "Under review",
};
const STATUS_COLORS: Record<MarketplaceOrderStatus, string> = {
  PAID: "#C9A227", HANDED_OVER: "#1B2A4A", COMPLETED: "#16A34A", CANCELLED: "#A8502E", DISPUTED: "#C9A227",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function hint(order: MarketplaceOrderItem, role: Role): string {
  switch (order.status) {
    case "PAID":
      if (!order.seller_deadline) return "";
      return role === "buying"
        ? `The seller must hand over by ${formatDate(order.seller_deadline)}, otherwise you are refunded automatically.`
        : `Hand the item over by ${formatDate(order.seller_deadline)}, otherwise the buyer is refunded automatically.`;
    case "HANDED_OVER":
      if (!order.auto_release_at) return "";
      return role === "buying"
        ? `Confirm you received it. If you do nothing, the payment is released to the seller on ${formatDate(order.auto_release_at)}.`
        : `Waiting for the buyer to confirm. The payment is released to you automatically on ${formatDate(order.auto_release_at)}.`;
    case "DISPUTED": return "Support is reviewing this order and will decide what happens to the payment.";
    case "COMPLETED": return "The payment was released to the seller.";
    case "CANCELLED": return "The payment was returned to the buyer.";
  }
}

/** Marketplace purchases and sales held in escrow: hand over, confirm receipt, cancel, decline or report a problem. */
export default function MarketplaceOrdersScreen({ navigation }: Props) {
  const [role, setRole] = useState<Role>("buying");
  const [orders, setOrders] = useState<MarketplaceOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async (which: Role) => {
    try {
      setOrders((await listMyMarketplaceOrders(which)).results);
      setError("");
    } catch (err) {
      setOrders([]);
      setError(err instanceof Error ? err.message : "Could not load your orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(role); }, [load, role]);

  async function run(orderId: string, action: MarketplaceOrderActionName, why?: string) {
    setError("");
    try {
      await marketplaceOrderAction(orderId, action, why);
      setDisputingId(null);
      setReason("");
      await load(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Please try again.");
    }
  }

  function confirmThen(message: string, orderId: string, action: MarketplaceOrderActionName) {
    Alert.alert("Are you sure?", message, [
      { text: "No", style: "cancel" },
      { text: "Yes", onPress: () => run(orderId, action) },
    ]);
  }

  function switchRole(next: Role) {
    setRole(next);
    setLoading(true);
    setError("");
    setDisputingId(null);
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(["buying", "selling"] as Role[]).map((value) => (
          <TouchableOpacity key={value} style={[styles.tab, role === value && styles.tabActive]} onPress={() => switchRole(value)}>
            <Text style={[styles.tabText, role === value && styles.tabTextActive]}>{value === "buying" ? "I am buying" : "I am selling"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.empty}>{role === "buying" ? "You have not bought anything yet." : "Nobody has bought your listings yet."}</Text>
              <TouchableOpacity onPress={() => navigation.navigate("Marketplace")}><Text style={styles.link}>Browse the marketplace</Text></TouchableOpacity>
            </View>
          }
          renderItem={({ item: order }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{order.listing_title}</Text>
                <View style={[styles.badge, { backgroundColor: STATUS_COLORS[order.status] }]}><Text style={styles.badgeText}>{STATUS_LABELS[order.status]}</Text></View>
              </View>
              <Text style={styles.meta}>
                {Number(order.amount_xaf).toLocaleString()} XAF · {role === "buying" ? `Seller: ${order.seller_name}` : `Buyer: ${order.buyer_name}`}
              </Text>
              <Text style={styles.date}>{formatDate(order.created_at)}</Text>
              <Text style={styles.hint}>{hint(order, role)}</Text>

              {disputingId === order.id ? (
                <View>
                  <TextInput style={styles.input} placeholder="Describe the problem" value={reason} onChangeText={setReason} multiline numberOfLines={3} />
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.primary, reason.trim().length < 5 && styles.disabled]} disabled={reason.trim().length < 5} onPress={() => run(order.id, "dispute", reason.trim())}>
                      <Text style={styles.primaryText}>Send to support</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setDisputingId(null)}><Text style={styles.secondary}>Close</Text></TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.actions}>
                  {role === "selling" && order.status === "PAID" && (
                    <>
                      <TouchableOpacity style={styles.primary} onPress={() => run(order.id, "hand-over")}><Text style={styles.primaryText}>Mark as handed over</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => confirmThen("Decline this order? The buyer will be refunded.", order.id, "decline")}><Text style={styles.danger}>Decline and refund</Text></TouchableOpacity>
                    </>
                  )}
                  {role === "buying" && order.status === "HANDED_OVER" && (
                    <TouchableOpacity style={styles.primary} onPress={() => confirmThen("Confirm you received what you paid for? The seller will be paid.", order.id, "confirm")}>
                      <Text style={styles.primaryText}>I received it</Text>
                    </TouchableOpacity>
                  )}
                  {role === "buying" && order.status === "PAID" && (
                    <TouchableOpacity onPress={() => confirmThen("Cancel this order and get a refund?", order.id, "cancel")}><Text style={styles.danger}>Cancel and refund me</Text></TouchableOpacity>
                  )}
                  {(order.status === "PAID" || order.status === "HANDED_OVER") && (
                    <TouchableOpacity onPress={() => { setDisputingId(order.id); setReason(""); }}><Text style={styles.secondary}>Report a problem</Text></TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  centered: { alignItems: "center", justifyContent: "center", paddingTop: 40 },
  tabs: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: "#E5E7EB" },
  tabActive: { backgroundColor: "#1B2A4A" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  tabTextActive: { color: "#fff" },
  error: { color: "#DC2626", fontSize: 13, paddingHorizontal: 16, paddingBottom: 4 },
  list: { padding: 16, paddingTop: 8 },
  empty: { color: "#6B7280", marginBottom: 8 },
  link: { color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline" },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  meta: { fontSize: 13, color: "#4B5563" },
  date: { fontSize: 11, color: "#9CA3AF", marginBottom: 8 },
  hint: { fontSize: 13, color: "#4B5563", marginBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  primaryText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
  secondary: { color: "#1B2A4A", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  danger: { color: "#B91C1C", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14, textAlignVertical: "top" },
});

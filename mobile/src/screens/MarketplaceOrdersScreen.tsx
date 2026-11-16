import { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  listMyMarketplaceOrders, marketplaceOrderAction, reviewMarketplaceOrder,
  type MarketplaceOrderItem, type MarketplaceOrderStatus, type MarketplaceOrderActionName,
} from "../lib/api";
import RateAndReport from "../components/RateAndReport";
import OrderTrackingPanel from "../components/OrderTrackingPanel";
import OrderReturnPanel from "../components/OrderReturnPanel";
import ReceiptModal from "../components/ReceiptModal";
import { confirmReceiptMessage } from "../lib/orderFulfilment";
import { MAX_REVIEW_LENGTH, starString } from "../lib/marketplaceReviews";
import { useI18n } from "../i18n";
import type { Translate } from "../i18n/translate";
import type { MessageKey } from "../i18n/messages";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceOrders">;
type Role = "buying" | "selling";

const STATUS_LABELS: Record<MarketplaceOrderStatus, MessageKey> = {
  PAYMENT_PENDING: "mkt.orders.status.PAYMENT_PENDING", PAID: "mkt.orders.status.PAID", HANDED_OVER: "mkt.orders.status.HANDED_OVER", COMPLETED: "mkt.orders.status.COMPLETED", CANCELLED: "mkt.orders.status.CANCELLED", DISPUTED: "mkt.orders.status.DISPUTED",
};
const STATUS_COLORS: Record<MarketplaceOrderStatus, string> = {
  PAYMENT_PENDING: "#6B7280", PAID: "#C9A227", HANDED_OVER: "#1B2A4A", COMPLETED: "#16A34A", CANCELLED: "#A8502E", DISPUTED: "#C9A227",
};

const DEPOSIT_LABELS: Record<MarketplaceOrderItem["deposit_status"], MessageKey> = {
  NONE: "mkt.orders.deposit.NONE", HELD: "mkt.orders.deposit.HELD", CLAIMED: "mkt.orders.deposit.CLAIMED", RETURNED: "mkt.orders.deposit.RETURNED", FORFEITED: "mkt.orders.deposit.FORFEITED",
};

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

// Rental dates are plain calendar days, so they are shown without a time or a timezone shift.
function formatDay(iso: string, locale: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { dateStyle: "medium" });
}

function depositHint(order: MarketplaceOrderItem, role: Role, t: Translate, locale: string): string {
  if (order.deposit_status === "CLAIMED") return t("mkt.orders.depositHint.claimed");
  if (order.status !== "COMPLETED" || order.deposit_status !== "HELD" || !order.deposit_return_by) return "";
  const date = formatDay(order.deposit_return_by, locale);
  return role === "buying"
    ? t("mkt.orders.depositHint.heldBuying", { date })
    : t("mkt.orders.depositHint.heldSelling", { date });
}

function hint(order: MarketplaceOrderItem, role: Role, t: Translate, locale: string): string {
  switch (order.status) {
    case "PAYMENT_PENDING": return t("mkt.orders.hint.paymentPending");
    case "PAID":
      if (!order.seller_deadline) return "";
      return role === "buying"
        ? t("mkt.orders.hint.paidBuying", { date: formatDate(order.seller_deadline, locale) })
        : t("mkt.orders.hint.paidSelling", { date: formatDate(order.seller_deadline, locale) });
    case "HANDED_OVER":
      if (!order.auto_release_at) return "";
      return role === "buying"
        ? t("mkt.orders.hint.handedOverBuying", { date: formatDate(order.auto_release_at, locale) })
        : t("mkt.orders.hint.handedOverSelling", { date: formatDate(order.auto_release_at, locale) });
    case "DISPUTED": return t("mkt.orders.hint.disputed");
    case "COMPLETED": return t("mkt.orders.hint.completed");
    case "CANCELLED": return t("mkt.orders.hint.cancelled");
  }
}

/** Marketplace purchases and sales held in escrow: hand over, confirm receipt, cancel, decline or report a problem. */
export default function MarketplaceOrdersScreen({ navigation, route }: Props) {
  const { t, locale } = useI18n();
  const [role, setRole] = useState<Role>(route.params?.role ?? "buying");
  const highlightId = route.params?.orderId;
  const listRef = useRef<FlatList<MarketplaceOrderItem>>(null);
  const [orders, setOrders] = useState<MarketplaceOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [disputing, setDisputing] = useState<{ id: string; action: "dispute" | "claim-deposit" } | null>(null);
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState<{ id: string; score: number; text: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [receipt, setReceipt] = useState<MarketplaceOrderItem | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const replaceOrder = useCallback((updated: MarketplaceOrderItem) => {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }, []);
  const load = useCallback(async (which: Role) => {
    try {
      setOrders((await listMyMarketplaceOrders(which)).results);
      setError("");
    } catch (err) {
      setOrders([]);
      setError(err instanceof Error ? err.message : tRef.current("mkt.orders.error.loadOrders"));
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

  useEffect(() => {
    const index = highlightId ? orders.findIndex((o) => o.id === highlightId) : -1;
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true });
  }, [highlightId, orders]);

  async function run(orderId: string, action: MarketplaceOrderActionName, why?: string) {
    setError("");
    try {
      await marketplaceOrderAction(orderId, action, why);
      setDisputing(null);
      setReason("");
      await load(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mkt.orders.error.actionFailed"));
    }
  }

  async function publishReview() {
    if (!reviewing) return;
    setPublishing(true);
    setError("");
    try {
      await reviewMarketplaceOrder(reviewing.id, reviewing.score, reviewing.text.trim());
      setReviewing(null);
      await load(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mkt.orders.error.publishReview"));
    } finally {
      setPublishing(false);
    }
  }

  function confirmThen(message: string, orderId: string, action: MarketplaceOrderActionName) {
    Alert.alert(t("mkt.orders.confirm.title"), message, [
      { text: t("mkt.orders.confirm.no"), style: "cancel" },
      { text: t("mkt.orders.confirm.yes"), onPress: () => run(orderId, action) },
    ]);
  }

  function switchRole(next: Role) {
    setRole(next);
    setLoading(true);
    setError("");
    setDisputing(null);
    setReviewing(null);
  }

  return (
    <View style={styles.container}>
      <ReceiptModal order={receipt} role={role} onClose={() => setReceipt(null)} />
      <View style={styles.tabs}>
        {(["buying", "selling"] as Role[]).map((value) => (
          <TouchableOpacity key={value} style={[styles.tab, role === value && styles.tabActive]} onPress={() => switchRole(value)}>
            <Text style={[styles.tabText, role === value && styles.tabTextActive]}>{value === "buying" ? t("mkt.orders.tab.buying") : t("mkt.orders.tab.selling")}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onScrollToIndexFailed={() => {}}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.empty}>{role === "buying" ? t("mkt.orders.empty.buying") : t("mkt.orders.empty.selling")}</Text>
              <TouchableOpacity onPress={() => navigation.navigate("Marketplace")}><Text style={styles.link}>{t("mkt.orders.browse")}</Text></TouchableOpacity>
            </View>
          }
          renderItem={({ item: order }) => (
            <View style={[styles.card, order.id === highlightId && styles.cardHighlight]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{order.listing_title}</Text>
                <View style={[styles.badge, { backgroundColor: STATUS_COLORS[order.status] }]}>                <Text style={styles.badgeText}>{t(STATUS_LABELS[order.status])}</Text></View>
              </View>
              {order.variant_label ? <Text style={styles.variant}>{order.variant_label}</Text> : null}
              <Text style={styles.meta}>
                                {Number(order.amount_xaf).toLocaleString(locale)} XAF · {role === "buying" ? t("mkt.orders.seller", { name: order.seller_name }) : t("mkt.orders.buyer", { name: order.buyer_name })}
              </Text>
              {Number(order.deposit_xaf) > 0 && (
                                <Text style={styles.meta}>{t("mkt.orders.depositLine", { amount: Number(order.deposit_xaf).toLocaleString(locale), status: t(DEPOSIT_LABELS[order.deposit_status]) })}</Text>
              )}
              {order.rental_starts_on && order.rental_ends_on && (
                                <Text style={styles.meta}>{t("mkt.orders.rentalLine", { start: formatDay(order.rental_starts_on, locale), end: formatDay(order.rental_ends_on, locale) })}</Text>
              )}
                              <Text style={styles.date}>{formatDate(order.created_at, locale)}</Text>
                              <Text style={styles.hint}>{[hint(order, role, t, locale), depositHint(order, role, t, locale)].filter(Boolean).join(" ")}</Text>
              <OrderTrackingPanel order={order} role={role} onUpdated={replaceOrder} />
              <OrderReturnPanel order={order} role={role} onUpdated={replaceOrder} />
              {order.receipt_available && (
                <TouchableOpacity style={styles.receiptButton} onPress={() => setReceipt(order)}><Text style={styles.secondary}>{t("mkt.orders.viewReceipt")}</Text></TouchableOpacity>
              )}

              {disputing?.id === order.id ? (
                <View>
                  <TextInput
                    style={styles.input} multiline numberOfLines={3} value={reason} onChangeText={setReason}
                    placeholder={disputing.action === "dispute" ? t("mkt.orders.dispute.placeholder") : t("mkt.orders.claim.placeholder")}
                  />
                  <View style={styles.actions}>
                    <TouchableOpacity style={[styles.primary, reason.trim().length < 5 && styles.disabled]} disabled={reason.trim().length < 5} onPress={() => run(order.id, disputing.action, reason.trim())}>
                      <Text style={styles.primaryText}>                      {disputing.action === "dispute" ? t("mkt.orders.dispute.send") : t("mkt.orders.claim.send")}</Text>
                    </TouchableOpacity>
                                          <TouchableOpacity onPress={() => setDisputing(null)}><Text style={styles.secondary}>{t("mkt.orders.close")}</Text></TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.actions}>
                  {role === "selling" && order.status === "PAID" && (
                    <>
                      {!order.is_tracked && (
                        <TouchableOpacity style={styles.primary} onPress={() => run(order.id, "hand-over")}>                        <Text style={styles.primaryText}>{t("mkt.orders.action.handOver")}</Text></TouchableOpacity>
                      )}
                                              <TouchableOpacity onPress={() => confirmThen(t("mkt.orders.confirm.decline"), order.id, "decline")}><Text style={styles.danger}>{t("mkt.orders.action.decline")}</Text></TouchableOpacity>
                    </>
                  )}
                  {role === "selling" && order.status === "COMPLETED" && order.deposit_status === "HELD" && (
                    <>
                      <TouchableOpacity style={styles.primary} onPress={() =>                       confirmThen(t("mkt.orders.confirm.returnDeposit"), order.id, "return-deposit")}><Text style={styles.primaryText}>{t("mkt.orders.action.returnDeposit")}</Text></TouchableOpacity>
                                            <TouchableOpacity onPress={() => { setDisputing({ id: order.id, action: "claim-deposit" }); setReason(""); }}><Text style={styles.danger}>{t("mkt.orders.action.claimDeposit")}</Text></TouchableOpacity>
                    </>
                  )}
                  {role === "buying" && order.status === "HANDED_OVER" && (
                    <TouchableOpacity style={styles.primary} onPress={() =>                     confirmThen(confirmReceiptMessage(order, t), order.id, "confirm")}>
                                          <Text style={styles.primaryText}>{t("mkt.orders.action.received")}</Text>
                    </TouchableOpacity>
                  )}
                  {role === "buying" && order.status === "PAID" && (
                                        <TouchableOpacity onPress={() => confirmThen(t("mkt.orders.confirm.cancel"), order.id, "cancel")}><Text style={styles.danger}>{t("mkt.orders.action.cancel")}</Text></TouchableOpacity>
                  )}
                  {(order.status === "PAID" || order.status === "HANDED_OVER") && (
                                        <TouchableOpacity onPress={() => { setDisputing({ id: order.id, action: "dispute" }); setReason(""); }}><Text style={styles.secondary}>{t("mkt.orders.action.report")}</Text></TouchableOpacity>
                  )}
                </View>
              )}
              {order.status === "COMPLETED" && (
                <RateAndReport subjectUserId={role === "buying" ? order.seller : order.buyer} />
              )}
              {role === "buying" && order.status === "COMPLETED" && order.my_review && (
                <View style={styles.review}>
                  <Text style={styles.reviewTitle}>{t("mkt.orders.review.yours")}</Text>
                  <Text style={styles.reviewStars}>{starString(order.my_review.score)}</Text>
                  {order.my_review.text ? <Text style={styles.reviewText}>{order.my_review.text}</Text> : null}
                </View>
              )}
              {role === "buying" && order.status === "COMPLETED" && order.can_review && !order.my_review && (
                reviewing?.id === order.id ? (
                  <View style={styles.review}>
                    <Text style={styles.reviewTitle}>{t("mkt.orders.review.title")}</Text>
                    <View style={styles.starRow}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <TouchableOpacity key={n} onPress={() => setReviewing({ ...reviewing, score: n })} accessibilityLabel={n === 1 ? t("mkt.orders.review.starOne", { count: n }) : t("mkt.orders.review.starMany", { count: n })}>
                          <Text style={styles.starPick}>{n <= reviewing.score ? "★" : "☆"}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      style={styles.input} multiline numberOfLines={3} maxLength={MAX_REVIEW_LENGTH} value={reviewing.text}
                      onChangeText={(text) => setReviewing({ ...reviewing, text })} placeholder={t("mkt.orders.review.placeholder")}
                    />
                    <View style={styles.actions}>
                      <TouchableOpacity style={[styles.primary, (publishing || reviewing.score < 1) && styles.disabled]} disabled={publishing || reviewing.score < 1} onPress={publishReview}>
                        {publishing ? <ActivityIndicator color="#1B2A4A" /> :                         <Text style={styles.primaryText}>{t("mkt.orders.review.publish")}</Text>}
                      </TouchableOpacity>
                                              <TouchableOpacity onPress={() => setReviewing(null)}><Text style={styles.secondary}>{t("mkt.orders.close")}</Text></TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.reviewButton} onPress={() => setReviewing({ id: order.id, score: 0, text: "" })}>
                    <Text style={styles.secondary}>{t("mkt.orders.review.title")}</Text>
                  </TouchableOpacity>
                )
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
  tab: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, backgroundColor: "#E5E7EB" },
  tabActive: { backgroundColor: "#1B2A4A" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  tabTextActive: { color: "#fff" },
  error: { color: "#DC2626", fontSize: 13, paddingHorizontal: 16, paddingBottom: 4 },
  list: { padding: 16, paddingTop: 8 },
  empty: { color: "#6B7280", marginBottom: 8 },
  link: { color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline" },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  cardHighlight: { borderColor: "#C9A227", borderWidth: 2 },
  variant: { fontSize: 13, color: "#4B5563", marginBottom: 4 },
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
  review: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  reviewButton: { marginTop: 12 },
  receiptButton: { marginTop: 10, alignSelf: "flex-start" },
  reviewTitle: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  reviewStars: { fontSize: 16, color: "#C9A227" },
  reviewText: { fontSize: 13, color: "#374151", marginTop: 2 },
  starRow: { flexDirection: "row", gap: 6, marginBottom: 8 },
  starPick: { fontSize: 30, color: "#C9A227" },
});

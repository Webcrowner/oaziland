import { useEffect, useState } from "react";
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Share } from "react-native";
import { listSellerPayouts, type MarketplaceOrderItem, type SellerPayoutRow } from "../lib/api";
import { payoutLines, receiptLines, receiptText, type OrderRole } from "../lib/orderFulfilment";

interface Props {
  order: MarketplaceOrderItem | null;
  role: OrderRole;
  onClose: () => void;
}

const MAX_PAYOUT_PAGES = 10;

async function findPayout(orderId: string): Promise<SellerPayoutRow | null> {
  for (let page = 1; page <= MAX_PAYOUT_PAGES; page++) {
    const data = await listSellerPayouts("all", page);
    const row = data.results.find((r) => r.order_id === orderId);
    if (row) return row;
    if (!data.next) return null;
  }
  return null;
}

/**
 * The receipt figures in the app. The PDF endpoint needs the auth header, so it cannot be opened from a link,
 * and the app has no file-system or sharing package to save it, so the figures are shown (and can be shared as text).
 */
export default function ReceiptModal({ order, role, onClose }: Props) {
  const [payout, setPayout] = useState<SellerPayoutRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const orderId = order?.id;

  useEffect(() => {
    setPayout(null);
    setError("");
    if (!orderId || role !== "selling") return;
    let cancelled = false;
    setLoading(true);
    findPayout(orderId)
      .then((row) => { if (!cancelled) setPayout(row); })
      .catch(() => { if (!cancelled) setError("Could not load the platform fee and payout."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, role]);

  const extra = payout ? payoutLines(payout) : [];

  async function share() {
    if (!order) return;
    try {
      await Share.share({ message: receiptText(order, extra), title: `Receipt for ${order.listing_title}` });
    } catch {
      setError("Could not share the receipt.");
    }
  }

  return (
    <Modal visible={!!order} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Receipt</Text>
          {order && (
            <ScrollView>
              {[...receiptLines(order), ...extra].map((line) => (
                <View key={line.label} style={styles.row}>
                  <Text style={styles.label}>{line.label}</Text>
                  <Text style={styles.value}>{line.value}</Text>
                </View>
              ))}
              {order.delivery_address ? <Text style={styles.muted}>Delivery address: {order.delivery_address}</Text> : null}
              {loading && <ActivityIndicator color="#1B2A4A" style={styles.spinner} />}
              {role === "selling" && !loading && !payout && !error && <Text style={styles.muted}>The platform fee and payout appear once the order is paid out.</Text>}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>
          )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.primary} onPress={share}><Text style={styles.primaryText}>Share receipt</Text></TouchableOpacity>
            <TouchableOpacity onPress={onClose}><Text style={styles.secondary}>Close</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: "80%" },
  title: { fontSize: 18, fontWeight: "700", color: "#1B2A4A", marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  label: { fontSize: 14, color: "#6B7280" },
  value: { flex: 1, textAlign: "right", fontSize: 14, fontWeight: "700", color: "#1B2A4A" },
  muted: { fontSize: 12, color: "#6B7280", marginTop: 10 },
  error: { color: "#DC2626", fontSize: 13, marginTop: 10 },
  spinner: { marginTop: 10 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 16 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  primaryText: { color: "#1B2A4A", fontWeight: "700", fontSize: 14 },
  secondary: { color: "#1B2A4A", fontSize: 14, fontWeight: "600", textDecorationLine: "underline" },
});

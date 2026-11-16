import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from "react-native";
import { updateMarketplaceShipment, type MarketplaceOrderItem } from "../lib/api";
import {
  canUpdateShipment, hasTracking, nextShipmentStatuses, shipmentDraftError, shipmentDraftFor, shipmentEventLabel, shipmentPayload,
  type OrderRole, type ShipmentDraft,
} from "../lib/orderFulfilment";
import { pickAndUploadPhoto } from "../lib/pickImage";
import { useI18n } from "../i18n";

interface Props {
  order: MarketplaceOrderItem;
  role: OrderRole;
  onUpdated: (order: MarketplaceOrderItem) => void;
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** Courier, tracking number, shipment timeline and proof of delivery; the seller also gets the form to post the next step. */
export default function OrderTrackingPanel({ order, role, onUpdated }: Props) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<ShipmentDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const canUpdate = canUpdateShipment(order, role);
  if (!hasTracking(order) && !canUpdate) return null;

  const setField = <K extends keyof ShipmentDraft>(key: K, value: ShipmentDraft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  async function pickProof() {
    setUploading(true);
    setError("");
    try {
      const url = await pickAndUploadPhoto();
      if (url) setField("proof_url", url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mkt.orders.error.uploadPhoto"));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!draft) return;
    const invalid = shipmentDraftError(draft, order, t);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      onUpdated(await updateMarketplaceShipment(order.id, shipmentPayload(draft)));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mkt.orders.error.updateDelivery"));
    } finally {
      setSubmitting(false);
    }
  }

  const events = [...order.shipment_events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{order.shipment_status ? t("mkt.orders.tracking.titleWithStatus", { status: shipmentEventLabel(order.shipment_status, t) }) : t("mkt.orders.tracking.title")}</Text>
      {order.courier_name ? <Text style={styles.line}>{t("mkt.orders.tracking.courier", { name: order.courier_name })}</Text> : null}
      {order.tracking_number ? <Text style={styles.line}>{t("mkt.orders.tracking.number", { number: order.tracking_number })}</Text> : null}
      {events.length === 0 && order.is_tracked && <Text style={styles.muted}>{t("mkt.orders.tracking.noUpdates")}</Text>}
      {events.map((event, index) => (
        <View key={`${event.at}-${index}`} style={styles.event}>
          <View style={styles.dot} />
          <View style={styles.eventText}>
            <Text style={styles.eventStatus}>{shipmentEventLabel(event.status, t)}</Text>
            {event.note ? <Text style={styles.line}>{event.note}</Text> : null}
            <Text style={styles.muted}>{formatDate(event.at, locale)}</Text>
          </View>
        </View>
      ))}
      {order.delivery_proof_url ? (
        <View>
          <Text style={styles.eventStatus}>{t("mkt.orders.tracking.proof")}</Text>
          <Image source={{ uri: order.delivery_proof_url }} style={styles.proof} resizeMode="cover" />
        </View>
      ) : null}

      {canUpdate && (draft ? (
        <View style={styles.form}>
          <Text style={styles.label}>{t("mkt.orders.tracking.nextStep")}</Text>
          <View style={styles.chips}>
            {nextShipmentStatuses(order.shipment_status).map((status) => (
              <TouchableOpacity key={status} style={[styles.chip, draft.status === status && styles.chipActive]} onPress={() => setField("status", status)}>
                <Text style={[styles.chipText, draft.status === status && styles.chipTextActive]}>{shipmentEventLabel(status, t)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input} value={draft.courier_name} onChangeText={(v) => setField("courier_name", v)}
            placeholder={order.delivery_method === "COURIER" ? t("mkt.orders.tracking.courierRequired") : t("mkt.orders.tracking.courierOptional")}
          />
          <TextInput style={styles.input} value={draft.tracking_number} onChangeText={(v) => setField("tracking_number", v)} placeholder={t("mkt.orders.tracking.numberOptional")} autoCapitalize="characters" />
          <TextInput
            style={[styles.input, styles.multiline]} multiline numberOfLines={2} value={draft.note} onChangeText={(v) => setField("note", v)}
            placeholder={draft.status === "DELIVERED" ? t("mkt.orders.tracking.noteDelivered") : t("mkt.orders.tracking.noteOptional")}
          />
          {draft.status === "DELIVERED" && (
            <View style={styles.proofRow}>
              <TouchableOpacity style={[styles.secondaryButton, uploading && styles.disabled]} disabled={uploading} onPress={pickProof}>
                {uploading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.secondary}>{draft.proof_url ? t("mkt.orders.tracking.changeProof") : t("mkt.orders.tracking.addProof")}</Text>}
              </TouchableOpacity>
              {draft.proof_url ? <Image source={{ uri: draft.proof_url }} style={styles.thumb} /> : null}
            </View>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.primary, (submitting || uploading) && styles.disabled]} disabled={submitting || uploading} onPress={submit}>
              {submitting ? <ActivityIndicator color="#1B2A4A" /> :               <Text style={styles.primaryText}>{t("mkt.orders.tracking.save")}</Text>}
            </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setDraft(null); setError(""); }}><Text style={styles.secondary}>{t("mkt.orders.close")}</Text></TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.primaryButton} onPress={() => { setDraft(shipmentDraftFor(order)); setError(""); }}>
                        <Text style={styles.primaryText}>{order.status === "PAID" ? t("mkt.orders.tracking.start") : t("mkt.orders.tracking.update")}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  title: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  line: { fontSize: 13, color: "#374151" },
  muted: { fontSize: 11, color: "#6B7280" },
  event: { flexDirection: "row", gap: 8, marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#C9A227", marginTop: 5 },
  eventText: { flex: 1 },
  eventStatus: { fontSize: 13, fontWeight: "600", color: "#1B2A4A", marginTop: 6 },
  proof: { width: "100%", height: 160, borderRadius: 8, marginTop: 4, backgroundColor: "#E5E7EB" },
  form: { marginTop: 10 },
  label: { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "#E5E7EB" },
  chipActive: { backgroundColor: "#1B2A4A" },
  chipText: { fontSize: 12, fontWeight: "600", color: "#374151" },
  chipTextActive: { color: "#fff" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14, backgroundColor: "#fff" },
  multiline: { textAlignVertical: "top" },
  proofRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  primaryButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, alignSelf: "flex-start", marginTop: 10 },
  primaryText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  secondaryButton: { paddingVertical: 4 },
  secondary: { color: "#1B2A4A", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  disabled: { opacity: 0.5 },
});

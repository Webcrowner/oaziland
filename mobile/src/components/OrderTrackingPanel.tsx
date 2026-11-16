import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from "react-native";
import { updateMarketplaceShipment, type MarketplaceOrderItem } from "../lib/api";
import {
  SHIPMENT_LABELS, canUpdateShipment, hasTracking, nextShipmentStatuses, shipmentDraftError, shipmentDraftFor, shipmentEventLabel, shipmentPayload,
  type OrderRole, type ShipmentDraft,
} from "../lib/orderFulfilment";
import { pickAndUploadPhoto } from "../lib/pickImage";

interface Props {
  order: MarketplaceOrderItem;
  role: OrderRole;
  onUpdated: (order: MarketplaceOrderItem) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Courier, tracking number, shipment timeline and proof of delivery; the seller also gets the form to post the next step. */
export default function OrderTrackingPanel({ order, role, onUpdated }: Props) {
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
      setError(err instanceof Error ? err.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!draft) return;
    const invalid = shipmentDraftError(draft, order);
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
      setError(err instanceof Error ? err.message : "Could not update the delivery.");
    } finally {
      setSubmitting(false);
    }
  }

  const events = [...order.shipment_events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Delivery{order.shipment_status ? `: ${SHIPMENT_LABELS[order.shipment_status]}` : ""}</Text>
      {order.courier_name ? <Text style={styles.line}>Courier: {order.courier_name}</Text> : null}
      {order.tracking_number ? <Text style={styles.line}>Tracking number: {order.tracking_number}</Text> : null}
      {events.length === 0 && order.is_tracked && <Text style={styles.muted}>No delivery updates yet.</Text>}
      {events.map((event, index) => (
        <View key={`${event.at}-${index}`} style={styles.event}>
          <View style={styles.dot} />
          <View style={styles.eventText}>
            <Text style={styles.eventStatus}>{shipmentEventLabel(event.status)}</Text>
            {event.note ? <Text style={styles.line}>{event.note}</Text> : null}
            <Text style={styles.muted}>{formatDate(event.at)}</Text>
          </View>
        </View>
      ))}
      {order.delivery_proof_url ? (
        <View>
          <Text style={styles.eventStatus}>Proof of delivery</Text>
          <Image source={{ uri: order.delivery_proof_url }} style={styles.proof} resizeMode="cover" />
        </View>
      ) : null}

      {canUpdate && (draft ? (
        <View style={styles.form}>
          <Text style={styles.label}>Next step</Text>
          <View style={styles.chips}>
            {nextShipmentStatuses(order.shipment_status).map((status) => (
              <TouchableOpacity key={status} style={[styles.chip, draft.status === status && styles.chipActive]} onPress={() => setField("status", status)}>
                <Text style={[styles.chipText, draft.status === status && styles.chipTextActive]}>{SHIPMENT_LABELS[status]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input} value={draft.courier_name} onChangeText={(v) => setField("courier_name", v)}
            placeholder={order.delivery_method === "COURIER" ? "Courier name (required)" : "Courier name (optional)"}
          />
          <TextInput style={styles.input} value={draft.tracking_number} onChangeText={(v) => setField("tracking_number", v)} placeholder="Tracking number (optional)" autoCapitalize="characters" />
          <TextInput
            style={[styles.input, styles.multiline]} multiline numberOfLines={2} value={draft.note} onChangeText={(v) => setField("note", v)}
            placeholder={draft.status === "DELIVERED" ? "Delivery note (needed without a proof photo)" : "Note (optional)"}
          />
          {draft.status === "DELIVERED" && (
            <View style={styles.proofRow}>
              <TouchableOpacity style={[styles.secondaryButton, uploading && styles.disabled]} disabled={uploading} onPress={pickProof}>
                {uploading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.secondary}>{draft.proof_url ? "Change proof photo" : "Add proof photo"}</Text>}
              </TouchableOpacity>
              {draft.proof_url ? <Image source={{ uri: draft.proof_url }} style={styles.thumb} /> : null}
            </View>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.primary, (submitting || uploading) && styles.disabled]} disabled={submitting || uploading} onPress={submit}>
              {submitting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.primaryText}>Save delivery update</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setDraft(null); setError(""); }}><Text style={styles.secondary}>Close</Text></TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.primaryButton} onPress={() => { setDraft(shipmentDraftFor(order)); setError(""); }}>
          <Text style={styles.primaryText}>{order.status === "PAID" ? "Start delivery" : "Update delivery"}</Text>
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

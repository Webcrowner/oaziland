import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image } from "react-native";
import {
  escalateMarketplaceReturn, requestMarketplaceReturn, respondMarketplaceReturn, withdrawMarketplaceReturn, type MarketplaceOrderItem,
} from "../lib/api";
import {
  EMPTY_RETURN_DRAFT, MAX_RETURN_EVIDENCE, RETURN_KINDS, RETURN_REASONS, rejectNoteError, returnActions, returnDeadline, returnDraftError, returnKindLabel,
  returnOutcomeText, returnPayload, returnReasonLabel, returnStatusLabel, type OrderRole, type ReturnDraft,
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

/** The return or refund request on an order: the buyer's request form, the status for both sides and each side's answers. */
export default function OrderReturnPanel({ order, role, onUpdated }: Props) {
  const request = order.return_request;
  const [draft, setDraft] = useState<ReturnDraft | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function run(task: () => Promise<MarketplaceOrderItem>, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      onUpdated(await task());
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirm(title: string, message: string, task: () => Promise<MarketplaceOrderItem>) {
    Alert.alert(title, message, [{ text: "No", style: "cancel" }, { text: "Yes", onPress: () => run(task) }]);
  }

  async function addEvidence() {
    setUploading(true);
    setError("");
    try {
      const url = await pickAndUploadPhoto();
      if (url) setDraft((prev) => (prev && prev.evidence.length < MAX_RETURN_EVIDENCE ? { ...prev, evidence: [...prev.evidence, url] } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
    }
  }

  function submitRequest() {
    if (!draft) return;
    const invalid = returnDraftError(draft, order.amount_xaf);
    if (invalid) {
      setError(invalid);
      return;
    }
    run(() => requestMarketplaceReturn(order.id, returnPayload(draft)), () => setDraft(null));
  }

  function submitReject() {
    const invalid = rejectNoteError(rejecting ?? "");
    if (invalid) {
      setError(invalid);
      return;
    }
    run(() => respondMarketplaceReturn(order.id, "REJECT", (rejecting ?? "").trim()), () => setRejecting(null));
  }

  const actions = returnActions(request, role);
  const deadline = request ? returnDeadline(request, role) : null;
  const canRequest = role === "buying" && order.can_request_return;
  if (!request && !canRequest) return null;

  return (
    <View style={styles.panel}>
      {request && (
        <View>
          <View style={styles.header}>
            <Text style={styles.title}>{returnKindLabel(request.kind)} request</Text>
            <Text style={styles.status}>{returnStatusLabel(request, role)}</Text>
          </View>
          <Text style={styles.line}>Reason: {returnReasonLabel(request.reason)}</Text>
          {request.kind === "PARTIAL_REFUND" && request.requested_amount_xaf ? (
            <Text style={styles.line}>Requested: {Number(request.requested_amount_xaf).toLocaleString("en-US")} XAF</Text>
          ) : null}
          <Text style={styles.line}>{request.description}</Text>
          {request.evidence_urls.length > 0 && (
            <View style={styles.thumbs}>
              {request.evidence_urls.map((url) => <Image key={url} source={{ uri: url }} style={styles.thumb} />)}
            </View>
          )}
          {request.seller_note ? <Text style={styles.note}>Seller: {request.seller_note}</Text> : null}
          {deadline ? <Text style={styles.muted}>{deadline.label} {formatDate(deadline.at)}</Text> : null}
          <Text style={styles.outcome}>{returnOutcomeText(request, role)}</Text>

          {rejecting !== null ? (
            <View>
              <TextInput
                style={styles.input} multiline numberOfLines={3} value={rejecting} onChangeText={setRejecting}
                placeholder="Tell the buyer why you are rejecting (required)"
              />
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={submitReject}>
                  {busy ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.primaryText}>Reject request</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setRejecting(null); setError(""); }}><Text style={styles.secondary}>Close</Text></TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              {actions.includes("accept") && (
                <TouchableOpacity
                  style={[styles.primary, busy && styles.disabled]} disabled={busy}
                  onPress={() => confirm(
                    "Accept this request?",
                    request.kind === "REPLACEMENT" ? "You agree to send a replacement." : "The buyer will be refunded from the payment held for this order.",
                    () => respondMarketplaceReturn(order.id, "ACCEPT", ""),
                  )}
                >
                  <Text style={styles.primaryText}>Accept</Text>
                </TouchableOpacity>
              )}
              {actions.includes("reject") && (
                <TouchableOpacity disabled={busy} onPress={() => { setRejecting(""); setError(""); }}><Text style={styles.danger}>Reject</Text></TouchableOpacity>
              )}
              {actions.includes("escalate") && (
                <TouchableOpacity
                  style={[styles.primary, busy && styles.disabled]} disabled={busy}
                  onPress={() => confirm("Send to support?", "Support will review this request and decide the outcome.", () => escalateMarketplaceReturn(order.id))}
                >
                  <Text style={styles.primaryText}>Send to support</Text>
                </TouchableOpacity>
              )}
              {actions.includes("withdraw") && (
                <TouchableOpacity disabled={busy} onPress={() => confirm("Withdraw this request?", "The request will be closed.", () => withdrawMarketplaceReturn(order.id))}>
                  <Text style={styles.danger}>Withdraw</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {canRequest && (draft ? (
        <View style={request ? styles.formGap : undefined}>
          <Text style={styles.title}>Request a return or refund</Text>
          <Text style={styles.label}>What do you want?</Text>
          <View style={styles.chips}>
            {RETURN_KINDS.map((kind) => (
              <TouchableOpacity key={kind.key} style={[styles.chip, draft.kind === kind.key && styles.chipActive]} onPress={() => setDraft({ ...draft, kind: kind.key })}>
                <Text style={[styles.chipText, draft.kind === kind.key && styles.chipTextActive]}>{kind.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Reason</Text>
          <View style={styles.chips}>
            {RETURN_REASONS.map((reason) => (
              <TouchableOpacity key={reason.key} style={[styles.chip, draft.reason === reason.key && styles.chipActive]} onPress={() => setDraft({ ...draft, reason: reason.key })}>
                <Text style={[styles.chipText, draft.reason === reason.key && styles.chipTextActive]}>{reason.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.input, styles.multiline]} multiline numberOfLines={4} value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })}
            placeholder="Describe the problem (at least 10 characters)"
          />
          {draft.kind === "PARTIAL_REFUND" && (
            <TextInput
              style={styles.input} keyboardType="number-pad" value={draft.amount} onChangeText={(amount) => setDraft({ ...draft, amount })}
              placeholder={`Refund amount in XAF (less than ${Number(order.amount_xaf).toLocaleString("en-US")})`}
            />
          )}
          <Text style={styles.label}>Photos ({draft.evidence.length}/{MAX_RETURN_EVIDENCE})</Text>
          <View style={styles.thumbs}>
            {draft.evidence.map((url) => (
              <TouchableOpacity key={url} onPress={() => setDraft({ ...draft, evidence: draft.evidence.filter((u) => u !== url) })} accessibilityLabel="Remove photo">
                <Image source={{ uri: url }} style={styles.thumb} />
              </TouchableOpacity>
            ))}
            {draft.evidence.length < MAX_RETURN_EVIDENCE && (
              <TouchableOpacity style={[styles.addPhoto, uploading && styles.disabled]} disabled={uploading} onPress={addEvidence}>
                {uploading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.addPhotoText}>+</Text>}
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.primary, (busy || uploading) && styles.disabled]} disabled={busy || uploading} onPress={submitRequest}>
              {busy ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.primaryText}>Send request</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setDraft(null); setError(""); }}><Text style={styles.secondary}>Close</Text></TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={request ? styles.formGap : undefined} onPress={() => { setDraft({ ...EMPTY_RETURN_DRAFT }); setError(""); }}>
          <Text style={styles.secondary}>Request a return or refund</Text>
        </TouchableOpacity>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#F3E8B5" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  title: { flex: 1, fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
  status: { fontSize: 12, fontWeight: "700", color: "#A8502E" },
  line: { fontSize: 13, color: "#374151", marginTop: 2 },
  note: { fontSize: 13, color: "#374151", fontStyle: "italic", marginTop: 6 },
  muted: { fontSize: 11, color: "#6B7280", marginTop: 4 },
  outcome: { fontSize: 13, color: "#4B5563", marginVertical: 6 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6, marginBottom: 6 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: "#E5E7EB" },
  addPhoto: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: "#9CA3AF", alignItems: "center", justifyContent: "center" },
  addPhotoText: { fontSize: 24, color: "#6B7280" },
  formGap: { marginTop: 8 },
  label: { fontSize: 12, fontWeight: "600", color: "#374151", marginTop: 6, marginBottom: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "#E5E7EB" },
  chipActive: { backgroundColor: "#1B2A4A" },
  chipText: { fontSize: 12, fontWeight: "600", color: "#374151" },
  chipTextActive: { color: "#fff" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14, backgroundColor: "#fff" },
  multiline: { textAlignVertical: "top" },
  error: { color: "#DC2626", fontSize: 13, marginTop: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14, marginTop: 4 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  primaryText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  secondary: { color: "#1B2A4A", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  danger: { color: "#B91C1C", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  disabled: { opacity: 0.5 },
});

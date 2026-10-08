import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { listMyServiceRequests, createServiceRequest, acceptServiceRequest, startServiceRequest, completeServiceRequest, releaseServiceRequest, markServiceRequestEnRoute, proposeServiceQuote, approveServiceQuote, disputeServiceRequest, rateServiceTechnician, getMyUserId, getServiceReceipt, listServiceRequestMessages, sendServiceRequestMessage, type ServiceRequestItem, type ServiceReceipt, type ServiceRequestMessageItem } from "../lib/api";

const CATEGORIES = ["PLUMBING", "ELECTRICAL", "PAINTING", "CLEANING", "MOVING", "SECURITY_INSTALLATION"];
const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#C9A227", ACCEPTED: "#1B2A4A", IN_PROGRESS: "#1B2A4A", COMPLETED: "#16A34A", CANCELLED: "#A8502E", DISPUTED: "#A8502E",
};

/** Private requester/technician chat for one job; refreshes every 10 seconds while open. */
function ServiceChat({ requestId, myUserId }: { requestId: string; myUserId: string | null }) {
  const [messages, setMessages] = useState<ServiceRequestMessageItem[]>([]);
  const [text, setText] = useState("");

  const load = useCallback(() => {
    listServiceRequestMessages(requestId).then(setMessages).catch(() => {});
  }, [requestId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function send() {
    if (!text.trim()) return;
    await sendServiceRequestMessage(requestId, text.trim()).catch(() => {});
    setText("");
    load();
  }

  return (
    <View style={{ marginTop: 6 }}>
      {messages.length === 0 ? <Text style={styles.description}>No messages yet.</Text> : null}
      {messages.map((m) => (
        <Text key={m.id} style={[styles.description, m.sender === myUserId && { textAlign: "right", fontWeight: "600" }]}>
          {m.sender === myUserId ? "" : `${m.sender_name}: `}{m.text}
        </Text>
      ))}
      <View style={styles.payRow}>
        <TextInput style={styles.payInput} placeholder="Type a message" value={text} onChangeText={setText} />
        <TouchableOpacity style={styles.payButton} onPress={send}><Text style={styles.payButtonText}>Send</Text></TouchableOpacity>
      </View>
    </View>
  );
}

function receiptFor(receipt: ServiceReceipt, item: ServiceRequestItem) {
  if (!receipt.receipt_number || item.status !== "COMPLETED") return null;
  return (
    <View style={{ marginVertical: 6 }}>
      <Text style={styles.category}>Receipt #{receipt.receipt_number.slice(0, 8).toUpperCase()}</Text>
      {receipt.labor_xaf ? <Text style={styles.description}>Labor: {receipt.labor_xaf} XAF</Text> : null}
      {receipt.materials_xaf ? <Text style={styles.description}>Materials: {receipt.materials_xaf} XAF</Text> : null}
      <Text style={styles.description}>Total: {receipt.total_xaf} XAF</Text>
    </View>
  );
}

/**
 * Taskln Service — mobile parity with the web app's /taskln-service
 * page, branded per the founder's explicit naming. Real on-demand
 * technician requests, same request -> accept -> start -> complete-
 * and-pay lifecycle as Rides.
 */
export default function TasklnServiceScreen() {
  const [requests, setRequests] = useState<ServiceRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("PLUMBING");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("SCHEDULED");
  const [requesting, setRequesting] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [quoteInputs, setQuoteInputs] = useState<Record<string, string>>({});
  const [materialsInputs, setMaterialsInputs] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<ServiceReceipt | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getMyUserId().then(setMyUserId).catch(() => {});
    listMyServiceRequests().then((data) => setRequests(data.results)).catch(() => setRequests([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // The job site location is required so technicians can find the requester.
  function handleRequest() {
    setError("");
    setRequesting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await createServiceRequest(category, description, priority, pos.coords.latitude, pos.coords.longitude);
          setDescription("");
          load();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not create the request");
        } finally {
          setRequesting(false);
        }
      },
      () => {
        setError("Allow location access so technicians can find you.");
        setRequesting(false);
      },
    );
  }

  async function runAction(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function handleComplete(id: string) {
    if (!phoneNumber) return;
    await runAction(() => completeServiceRequest(id, phoneNumber));
    setPayingId(null);
    setPhoneNumber("");
  }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={requests}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.formCard}>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} style={[styles.categoryChip, category === c && styles.categoryChipActive]} onPress={() => setCategory(c)}>
                <Text style={[styles.categoryChipText, category === c && styles.categoryChipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.priorityToggle} onPress={() => setPriority(priority === "URGENT" ? "SCHEDULED" : "URGENT")}>
            <Text style={styles.priorityToggleText}>{priority === "URGENT" ? "⚡ Urgent" : "📅 Scheduled"} (tap to change)</Text>
          </TouchableOpacity>
          <TextInput style={styles.textArea} placeholder="Describe what you need done..." value={description} onChangeText={setDescription} multiline numberOfLines={3} />
          <TouchableOpacity style={styles.requestButton} onPress={handleRequest} disabled={requesting}>
            {requesting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.requestButtonText}>Request Taskln Service</Text>}
          </TouchableOpacity>
          {error ? <Text style={styles.empty}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No requests yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.category}>{item.category}</Text>
            <View style={styles.badgeGroup}>
              {item.priority === "URGENT" && <View style={styles.urgentBadge}><Text style={styles.urgentBadgeText}>URGENT</Text></View>}
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] || "#9CA3AF" }]}>
                <Text style={styles.statusBadgeText}>{item.status.replace("_", " ")}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.description}>{item.description}</Text>

          {item.quoted_amount_xaf && (
            <Text style={styles.description}>Quote: {item.quoted_amount_xaf} XAF {item.quote_approved ? "(approved)" : "(awaiting approval)"}</Text>
          )}

          {item.status === "REQUESTED" && item.requester !== myUserId && (
            <TouchableOpacity onPress={() => runAction(() => acceptServiceRequest(item.id))}><Text style={styles.actionLink}>Accept as Technician</Text></TouchableOpacity>
          )}
          {item.technician === myUserId && item.status === "ACCEPTED" && (
            <TouchableOpacity onPress={() => runAction(() => markServiceRequestEnRoute(item.id))}><Text style={styles.actionLink}>I&apos;m on my way</Text></TouchableOpacity>
          )}
          {item.technician === myUserId && (item.status === "ACCEPTED" || item.status === "EN_ROUTE") && (
            <>
              <TouchableOpacity onPress={() => runAction(() => startServiceRequest(item.id))} disabled={!item.quote_approved}>
                <Text style={[styles.actionLink, !item.quote_approved && { opacity: 0.4 }]}>Start Job</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => runAction(() => releaseServiceRequest(item.id))}><Text style={styles.actionLink}>Release job</Text></TouchableOpacity>
            </>
          )}
          {item.technician === myUserId && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder="Labor (XAF)" value={quoteInputs[item.id] || ""} onChangeText={(v) => setQuoteInputs((prev) => ({ ...prev, [item.id]: v }))} keyboardType="numeric" />
              <TextInput style={styles.payInput} placeholder="Materials (XAF)" value={materialsInputs[item.id] || ""} onChangeText={(v) => setMaterialsInputs((prev) => ({ ...prev, [item.id]: v }))} keyboardType="numeric" />
              <TouchableOpacity style={styles.payButton} onPress={() => runAction(() => proposeServiceQuote(item.id, quoteInputs[item.id] || "", materialsInputs[item.id]))}>
                <Text style={styles.payButtonText}>Send quote</Text>
              </TouchableOpacity>
            </View>
          )}
          {item.requester === myUserId && item.quoted_amount_xaf && !item.quote_approved && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && (
            <TouchableOpacity onPress={() => runAction(() => approveServiceQuote(item.id))}><Text style={styles.actionLink}>Approve quote</Text></TouchableOpacity>
          )}
          {item.requester === myUserId && item.status === "IN_PROGRESS" && item.quote_approved && payingId !== item.id && (
            <TouchableOpacity onPress={() => setPayingId(item.id)}><Text style={styles.actionLink}>Complete & Pay</Text></TouchableOpacity>
          )}
          {payingId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} />
              <TouchableOpacity style={styles.payButton} onPress={() => handleComplete(item.id)}>
                <Text style={styles.payButtonText}>Pay {item.quoted_amount_xaf} XAF</Text>
              </TouchableOpacity>
            </View>
          )}

          {item.status === "DISPUTED" && item.dispute_reason ? <Text style={styles.description}>Disputed: {item.dispute_reason}</Text> : null}
          {(item.requester === myUserId || item.technician === myUserId) && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && disputeId !== item.id && (
            <TouchableOpacity onPress={() => setDisputeId(item.id)}><Text style={styles.actionLink}>Report a problem</Text></TouchableOpacity>
          )}
          {disputeId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder="What went wrong?" value={disputeReason} onChangeText={setDisputeReason} />
              <TouchableOpacity
                style={styles.payButton} disabled={disputeReason.trim().length < 5}
                onPress={async () => { await runAction(() => disputeServiceRequest(item.id, disputeReason)); setDisputeId(null); setDisputeReason(""); }}
              >
                <Text style={styles.payButtonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          )}
          {item.requester === myUserId && item.status === "COMPLETED" && item.technician && (
            <View style={styles.payRow}>
              <Text style={styles.description}>Rate your technician:</Text>
              {[1, 2, 3, 4, 5].map((score) => (
                <TouchableOpacity key={score} onPress={() => runAction(() => rateServiceTechnician(item.id, score))}>
                  <Text style={styles.actionLink}>{score}★</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {item.scheduled_for ? <Text style={styles.description}>Scheduled for {new Date(item.scheduled_for).toLocaleString()}</Text> : null}
          {(item.requester === myUserId || item.technician === myUserId) && item.status === "COMPLETED" && (
            <TouchableOpacity onPress={() => runAction(async () => { setReceipt(await getServiceReceipt(item.id)); setReceiptId(item.id); })}><Text style={styles.actionLink}>View receipt</Text></TouchableOpacity>
          )}
          {receipt && receiptId === item.id && receiptFor(receipt, item)}
          {item.technician && (item.requester === myUserId || item.technician === myUserId) && item.status !== "CANCELLED" && (
            <>
              <TouchableOpacity onPress={() => setChatId(chatId === item.id ? null : item.id)}><Text style={styles.actionLink}>{chatId === item.id ? "Hide chat" : "Chat"}</Text></TouchableOpacity>
              {chatId === item.id && <ServiceChat requestId={item.id} myUserId={myUserId} />}
            </>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  formCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, marginBottom: 16 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  categoryChip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  categoryChipActive: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  categoryChipText: { fontSize: 11, color: "#374151" },
  categoryChipTextActive: { color: "#fff", fontWeight: "700" },
  priorityToggle: { marginBottom: 10 },
  priorityToggleText: { fontSize: 12, color: "#6B7280" },
  textArea: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14, textAlignVertical: "top" },
  requestButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  requestButtonText: { color: "#1B2A4A", fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  category: { fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
  badgeGroup: { flexDirection: "row", gap: 6 },
  urgentBadge: { backgroundColor: "#A8502E", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  urgentBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  description: { fontSize: 13, color: "#374151", marginBottom: 8 },
  actionLink: { fontSize: 13, color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline" },
  payRow: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  payInput: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 6, padding: 8, fontSize: 13, minWidth: 100 },
  payButton: { backgroundColor: "#C9A227", borderRadius: 6, paddingHorizontal: 16, justifyContent: "center" },
  payButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
});

import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { listMyServiceRequests, createServiceRequest, acceptServiceRequest, startServiceRequest, completeServiceRequest, type ServiceRequestItem } from "../lib/api";

const CATEGORIES = ["PLUMBING", "ELECTRICAL", "PAINTING", "CLEANING", "MOVING", "SECURITY_INSTALLATION"];
const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#C9A227", ACCEPTED: "#1B2A4A", IN_PROGRESS: "#1B2A4A", COMPLETED: "#16A34A", CANCELLED: "#A8502E", DISPUTED: "#A8502E",
};

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
  const [amount, setAmount] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const load = useCallback(() => {
    listMyServiceRequests().then((data) => setRequests(data.results)).catch(() => setRequests([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRequest() {
    setRequesting(true);
    try {
      await createServiceRequest(category, description, priority);
      setDescription("");
      load();
    } finally {
      setRequesting(false);
    }
  }

  async function handleAccept(id: string) { await acceptServiceRequest(id); load(); }
  async function handleStart(id: string) { await startServiceRequest(id); load(); }
  async function handleComplete(id: string) {
    if (!amount || !phoneNumber) return;
    await completeServiceRequest(id, amount, phoneNumber);
    setPayingId(null);
    setAmount(""); setPhoneNumber("");
    load();
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

          {item.status === "REQUESTED" && (
            <TouchableOpacity onPress={() => handleAccept(item.id)}><Text style={styles.actionLink}>Accept as Technician</Text></TouchableOpacity>
          )}
          {item.status === "ACCEPTED" && (
            <TouchableOpacity onPress={() => handleStart(item.id)}><Text style={styles.actionLink}>Start Job</Text></TouchableOpacity>
          )}
          {item.status === "IN_PROGRESS" && payingId !== item.id && (
            <TouchableOpacity onPress={() => setPayingId(item.id)}><Text style={styles.actionLink}>Complete & Pay</Text></TouchableOpacity>
          )}
          {payingId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder="Amount (XAF)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
              <TextInput style={styles.payInput} placeholder="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} />
              <TouchableOpacity style={styles.payButton} onPress={() => handleComplete(item.id)}>
                <Text style={styles.payButtonText}>Pay</Text>
              </TouchableOpacity>
            </View>
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

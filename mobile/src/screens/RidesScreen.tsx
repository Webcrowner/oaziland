import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { listMyRides, requestRide, acceptRide, startRide, completeRide, type RideBookingItem } from "../lib/api";

const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#C9A227", ACCEPTED: "#1B2A4A", IN_PROGRESS: "#1B2A4A", COMPLETED: "#16A34A", CANCELLED: "#A8502E",
};

/**
 * Rides — mobile parity with the web app's /marketplace/rides page.
 * Same real request -> accept -> start -> complete-and-pay lifecycle;
 * anyone can be a driver here per the platform's own real design, so
 * the same screen both requests and fulfills rides.
 */
export default function RidesScreen() {
  const [rides, setRides] = useState<RideBookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [distance, setDistance] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  const load = useCallback(() => {
    listMyRides().then((data) => setRides(data.results)).catch(() => setRides([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRequest() {
    setRequesting(true);
    try {
      await requestRide(pickup, dropoff, distance);
      setPickup(""); setDropoff(""); setDistance("");
      load();
    } finally {
      setRequesting(false);
    }
  }

  async function handleAccept(id: string) { await acceptRide(id); load(); }
  async function handleStart(id: string) { await startRide(id); load(); }
  async function handleComplete(id: string) {
    if (!phoneNumber) return;
    await completeRide(id, phoneNumber);
    setPayingId(null);
    setPhoneNumber("");
    load();
  }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={rides}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.formCard}>
          <TextInput style={styles.input} placeholder="Pickup location" value={pickup} onChangeText={setPickup} />
          <TextInput style={styles.input} placeholder="Drop-off location" value={dropoff} onChangeText={setDropoff} />
          <TextInput style={styles.input} placeholder="Distance (km)" value={distance} onChangeText={setDistance} keyboardType="numeric" />
          <TouchableOpacity style={styles.requestButton} onPress={handleRequest} disabled={requesting}>
            {requesting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.requestButtonText}>Request Ride</Text>}
          </TouchableOpacity>
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No rides yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.route}>{item.pickup_description} → {item.dropoff_description}</Text>
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] || "#9CA3AF" }]}>
              <Text style={styles.statusBadgeText}>{item.status.replace("_", " ")}</Text>
            </View>
          </View>
          <Text style={styles.fare}>{Number(item.fare_estimate_xaf).toLocaleString()} XAF</Text>

          {item.status === "REQUESTED" && (
            <TouchableOpacity onPress={() => handleAccept(item.id)}><Text style={styles.actionLink}>Accept as Driver</Text></TouchableOpacity>
          )}
          {item.status === "ACCEPTED" && (
            <TouchableOpacity onPress={() => handleStart(item.id)}><Text style={styles.actionLink}>Start Ride</Text></TouchableOpacity>
          )}
          {item.status === "IN_PROGRESS" && payingId !== item.id && (
            <TouchableOpacity onPress={() => setPayingId(item.id)}><Text style={styles.actionLink}>Complete & Pay</Text></TouchableOpacity>
          )}
          {payingId === item.id && (
            <View style={styles.payRow}>
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
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14 },
  requestButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  requestButtonText: { color: "#1B2A4A", fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  route: { flex: 1, fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginRight: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  fare: { fontSize: 14, color: "#374151", marginBottom: 8 },
  actionLink: { fontSize: 13, color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline" },
  payRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  payInput: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 6, padding: 8, fontSize: 13 },
  payButton: { backgroundColor: "#C9A227", borderRadius: 6, paddingHorizontal: 16, justifyContent: "center" },
  payButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
});

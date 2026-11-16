import { useState, useEffect } from "react";
import { View, Text, TextInput, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Modal, ScrollView } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { createEventBooking, searchVenues, type Venue, type VenueSpaceSummary } from "../lib/api";
import { localNowString, validateVenueBooking } from "../lib/venueBookings";
import type { RootStackParamList } from "../navigation/AppNavigator";

/** Event venues: browse, book a space (the deposit is paid from "My venue bookings"), and open your bookings. */
export default function EventsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<VenueSpaceSummary | null>(null);
  const [eventType, setEventType] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [guests, setGuests] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    searchVenues()
      .then((data) => setVenues(data.results))
      .catch(() => setVenues([]))
      .finally(() => setLoading(false));
  }, []);

  async function openBooking(space: VenueSpaceSummary) {
    if (!(await SecureStore.getItemAsync("access_token"))) {
      navigation.navigate("Login");
      return;
    }
    setBooking(space);
    setError("");
  }

  async function submit() {
    if (!booking) return;
    const checked = validateVenueBooking(
      { eventType, date: date.trim(), start: start.trim(), end: end.trim(), guests: guests.trim(), hourlyRateXaf: Number(booking.base_price_per_hour_xaf) },
      localNowString().slice(0, 10),
    );
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await createEventBooking({
        venue_space: booking.id, event_type: checked.value.event_type, event_date: checked.value.event_date,
        start_time: checked.value.start_time, end_time: checked.value.end_time, guest_count: checked.value.guest_count,
      });
      setBooking(null);
      setEventType(""); setDate(""); setStart(""); setEnd(""); setGuests("");
      navigation.navigate("VenueBookings");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not book this venue.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={venues}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <TouchableOpacity style={styles.bookingsButton} onPress={() => navigation.navigate("VenueBookings")}>
            <Text style={styles.bookingsButtonText}>My venue bookings</Text>
          </TouchableOpacity>
        }
        ListEmptyComponent={<Text style={styles.empty}>No verified venues are listed yet.</Text>}
        renderItem={({ item }) => {
          const cheapestSpace = item.spaces.length
            ? item.spaces.reduce((min, s) => (Number(s.base_price_per_hour_xaf) < Number(min.base_price_per_hour_xaf) ? s : min))
            : null;
          return (
            <View style={styles.card}>
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imagePlaceholderText}>No photo yet</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.location}>{item.quarter_name}</Text>
                <Text style={styles.spaceCount}>{item.spaces.length} space{item.spaces.length === 1 ? "" : "s"} available</Text>
                {item.spaces[0] ? (
                  <View style={styles.capacityRow}>
                    {item.spaces[0].capacity_theatre ? <Text style={styles.capacity}>Theatre: {item.spaces[0].capacity_theatre}</Text> : null}
                    {item.spaces[0].capacity_banquet ? <Text style={styles.capacity}>Banquet: {item.spaces[0].capacity_banquet}</Text> : null}
                  </View>
                ) : null}
                {cheapestSpace ? (
                  <Text style={styles.price}>{Number(cheapestSpace.base_price_per_hour_xaf).toLocaleString()} XAF <Text style={styles.perHour}>/ hour</Text></Text>
                ) : null}
                {item.spaces.map((space) => (
                  <TouchableOpacity key={space.id} style={styles.spaceRow} onPress={() => openBooking(space)}>
                    <Text style={styles.spaceName}>{space.space_name} · {Number(space.base_price_per_hour_xaf).toLocaleString()} XAF/h</Text>
                    <Text style={styles.bookLink}>Book</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        }}
      />

      <Modal visible={booking !== null} animationType="slide" onRequestClose={() => setBooking(null)}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.formTitle}>Book {booking?.space_name}</Text>
          <TextInput style={styles.input} placeholder="Event type (wedding, conference...)" value={eventType} onChangeText={setEventType} />
          <TextInput style={styles.input} placeholder="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} autoCapitalize="none" />
          <View style={styles.times}>
            <TextInput style={[styles.input, styles.half]} placeholder="Start (HH:MM)" value={start} onChangeText={setStart} autoCapitalize="none" />
            <TextInput style={[styles.input, styles.half]} placeholder="End (HH:MM)" value={end} onChangeText={setEnd} autoCapitalize="none" />
          </View>
          <TextInput style={styles.input} placeholder="Number of guests" value={guests} onChangeText={setGuests} keyboardType="number-pad" />
          <Text style={styles.hint}>The price comes from the space's hourly rate. After booking you pay a 30% deposit to confirm the date; free cancellation until 7 days before the event.</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity style={[styles.submit, submitting && styles.disabled]} disabled={submitting} onPress={submit}>
            {submitting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitText}>Book this space</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setBooking(null)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        </ScrollView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  bookingsButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 16 },
  bookingsButtonText: { color: "#fff", fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 10, marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  imagePlaceholder: { height: 140, backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  imagePlaceholderText: { color: "#4B5563" },
  cardBody: { padding: 12 },
  location: { fontSize: 14, color: "#6B7280", marginBottom: 4 },
  spaceCount: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  capacityRow: { flexDirection: "row", gap: 12, marginBottom: 6 },
  capacity: { fontSize: 12, color: "#6B7280" },
  price: { fontSize: 18, fontWeight: "bold", color: "#1B2A4A" },
  perHour: { fontSize: 13, fontWeight: "normal", color: "#6B7280" },
  spaceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  spaceName: { flex: 1, fontSize: 13, color: "#1B2A4A", fontWeight: "600" },
  bookLink: { fontSize: 13, fontWeight: "700", color: "#C9A227" },
  form: { padding: 20 },
  formTitle: { fontSize: 20, fontWeight: "700", color: "#1B2A4A", marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 14 },
  times: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  hint: { fontSize: 12, color: "#6B7280", marginBottom: 12 },
  errorText: { color: "#DC2626", fontSize: 13, marginBottom: 12 },
  submit: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
  submitText: { color: "#1B2A4A", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.5 },
  cancelText: { textAlign: "center", color: "#6B7280" },
});

import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, Alert } from "react-native";
import {
  eventBookingAction, getEventBooking, listEventBookings, payEventBooking,
  type EventBookingActionName, type EventBookingItem,
} from "../lib/api";
import { availableActions, localNowString, STATUS_LABEL } from "../lib/venueBookings";
import { usePollWhile } from "../lib/usePollWhile";

type Role = "organiser" | "owner";

const STATUS_COLORS: Record<EventBookingItem["status"], string> = { PENDING: "#C9A227", CONFIRMED: "#16A34A", COMPLETED: "#1B2A4A", CANCELLED: "#A8502E" };

function day(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" });
}

const xaf = (value: string | number) => `${Number(value).toLocaleString()} XAF`;

/** Venue bookings: the organiser pays the deposit and balance, cancels, confirms or reports a problem; the venue's
 * owner sees who booked, cancels (full refund) or releases the payment once the event is over. The server enforces
 * every rule; this screen shows what is possible and what each choice costs. */
export default function VenueBookingsScreen() {
  const [role, setRole] = useState<Role>("organiser");
  const [rows, setRows] = useState<EventBookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paying, setPaying] = useState<{ id: string; part: "deposit" | "balance" } | null>(null);
  const [awaiting, setAwaiting] = useState<{ id: string; part: "deposit" | "balance" } | null>(null);
  const [phone, setPhone] = useState("");
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async (which: Role) => {
    try {
      setRows(await listEventBookings(which));
      setError("");
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Could not load your venue bookings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(role); }, [load, role]);

  // A real payment is confirmed by the provider after the payer approves it on their phone: watch until it is.
  const waiting = awaiting !== null;
  usePollWhile(
    waiting,
    async () => {
      if (!awaiting) return;
      try {
        const fresh = await getEventBooking(awaiting.id);
        const paid = awaiting.part === "deposit" ? fresh.deposit_paid : fresh.balance_paid;
        if (paid || fresh.status === "CANCELLED") {
          setAwaiting(null);
          if (fresh.status === "CANCELLED") setNotice("The payment arrived after this booking could no longer be confirmed, so it was returned in full to your Oaziland wallet.");
          await load(role);
        }
      } catch {
        // A failed check is not a failed payment: keep waiting and ask again.
      }
    },
    () => {
      setAwaiting(null);
      Alert.alert("Payment not confirmed yet", "If you approved it, the booking updates as soon as the payment arrives. If it arrives too late, it is returned to your Oaziland wallet.");
    },
  );

  async function run(id: string, action: EventBookingActionName, success: string, why?: string) {
    setError("");
    setNotice("");
    try {
      await eventBookingAction(id, action, why);
      setNotice(success);
      setReporting(null);
      setReason("");
      await load(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Please try again.");
    }
  }

  function confirmThen(title: string, message: string, onYes: () => void) {
    Alert.alert(title, message, [{ text: "No", style: "cancel" }, { text: "Yes", onPress: onYes }]);
  }

  function cancelMessage(b: EventBookingItem): string {
    const c = b.cancellation;
    if (!c) return "Cancel this booking?";
    if (role === "owner") return `The organiser is refunded in full (${xaf(c.refund_xaf)}) and you receive nothing. Cancel this booking?`;
    return c.free
      ? `It is free: ${xaf(c.refund_xaf)} goes back to your Oaziland wallet. Cancel this booking?`
      : `It is too late for a free cancellation: the venue keeps the deposit (${xaf(c.fee_xaf)}) and ${xaf(c.refund_xaf)} goes back to your Oaziland wallet. Cancel this booking?`;
  }

  async function startPayment() {
    if (!paying || !phone.trim()) return;
    setError("");
    try {
      const { confirmed } = await payEventBooking(paying.id, paying.part, phone.trim());
      if (confirmed) {
        await load(role);
      } else {
        setAwaiting(paying);
      }
      setPaying(null);
      setPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment could not be started.");
    }
  }

  function switchRole(next: Role) {
    setRole(next);
    setLoading(true);
    setError("");
    setNotice("");
    setPaying(null);
    setReporting(null);
  }

  const now = localNowString();

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(["organiser", "owner"] as Role[]).map((value) => (
          <TouchableOpacity key={value} style={[styles.tab, role === value && styles.tabActive]} onPress={() => switchRole(value)}>
            <Text style={[styles.tabText, role === value && styles.tabTextActive]}>{value === "organiser" ? "I booked" : "At my venues"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {loading ? (
        <ActivityIndicator color="#1B2A4A" size="large" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{role === "organiser" ? "You have not booked a venue yet." : "Nobody has booked your venues yet."}</Text>}
          renderItem={({ item: b }) => {
            const actions = availableActions(b, role, now);
            const isPaying = paying?.id === b.id;
            const isWaiting = awaiting?.id === b.id;
            return (
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>{b.space_name}{role === "owner" && b.organiser_name ? ` · ${b.organiser_name}` : ""}</Text>
                  <Text style={[styles.status, { color: STATUS_COLORS[b.status] }]}>{STATUS_LABEL[b.status]}</Text>
                </View>
                <Text style={styles.meta}>{day(b.event_date)} · {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)} · {b.guest_count} guests · {xaf(b.total_cost_xaf)}</Text>
                {b.status !== "CANCELLED" ? (
                  <Text style={styles.meta}>Deposit: {b.deposit_paid ? "paid" : "not paid"} · Balance: {b.balance_paid ? "paid" : "not paid"}</Text>
                ) : null}
                {b.balance_due_at ? <Text style={styles.warn}>Balance due by {day(b.balance_due_at)}. If it is not paid in time the booking is cancelled and the venue keeps the deposit.</Text> : null}
                {role === "organiser" && b.payment_held && b.payout_due_at ? (
                  <Text style={styles.meta}>Your payment is held safely. If you report no problem, the venue is paid automatically on {day(b.payout_due_at)}.</Text>
                ) : null}
                {role === "owner" && b.owner_payout_xaf && b.payout_due_at ? (
                  <Text style={styles.meta}>You will receive {xaf(b.owner_payout_xaf)} (after the platform fee), released on {day(b.payout_due_at)} unless a problem is reported.</Text>
                ) : null}
                {isWaiting ? <Text style={styles.warn}>Approve the payment on your phone with your Mobile Money PIN. This updates by itself once it is confirmed.</Text> : null}

                {isPaying ? (
                  <View style={styles.payRow}>
                    <TextInput style={styles.input} placeholder="Mobile money phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
                    <TouchableOpacity style={[styles.primary, !phone.trim() && styles.disabled]} disabled={!phone.trim()} onPress={startPayment}>
                      <Text style={styles.primaryText}>Pay {xaf(paying.part === "deposit" ? b.deposit_amount_xaf : b.balance_amount_xaf)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setPaying(null)}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
                  </View>
                ) : null}

                {!isPaying && !isWaiting ? (
                  <View style={styles.actions}>
                    {actions.includes("pay-deposit") ? <TouchableOpacity onPress={() => { setPaying({ id: b.id, part: "deposit" }); setPhone(""); }}><Text style={styles.link}>Pay deposit ({xaf(b.deposit_amount_xaf)})</Text></TouchableOpacity> : null}
                    {actions.includes("pay-balance") ? <TouchableOpacity onPress={() => { setPaying({ id: b.id, part: "balance" }); setPhone(""); }}><Text style={styles.link}>Pay balance ({xaf(b.balance_amount_xaf)})</Text></TouchableOpacity> : null}
                    {actions.includes("confirm-event") ? (
                      <TouchableOpacity onPress={() => confirmThen("Confirm the event?", "The venue is paid at once and you can no longer report a problem.", () => run(b.id, "confirm-event", "Thank you! The venue has been paid."))}>
                        <Text style={styles.link}>Confirm it went well</Text>
                      </TouchableOpacity>
                    ) : null}
                    {actions.includes("report") ? <TouchableOpacity onPress={() => setReporting(reporting === b.id ? null : b.id)}><Text style={styles.linkDanger}>Report a problem</Text></TouchableOpacity> : null}
                    {actions.includes("complete") ? (
                      <TouchableOpacity onPress={() => confirmThen("Event done?", "Mark this event as done and release the payment to your wallet now?", () => run(b.id, "complete", "Done. The payment was released to your wallet."))}>
                        <Text style={styles.link}>Event done: release my payment</Text>
                      </TouchableOpacity>
                    ) : null}
                    {actions.includes("cancel") ? (
                      <TouchableOpacity onPress={() => confirmThen("Cancel booking?", cancelMessage(b), () => run(b.id, "cancel", role === "owner" ? "The booking was cancelled and the organiser was refunded." : "Your booking was cancelled."))}>
                        <Text style={styles.linkDanger}>Cancel booking</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}

                {reporting === b.id ? (
                  <View style={styles.reportBox}>
                    <Text style={styles.meta}>What went wrong? Your payment stays frozen while support reviews it.</Text>
                    <TextInput style={[styles.input, { height: 80 }]} multiline value={reason} onChangeText={setReason} placeholder="Describe the problem" />
                    <TouchableOpacity style={[styles.primary, reason.trim().length < 5 && styles.disabled]} disabled={reason.trim().length < 5} onPress={() => run(b.id, "dispute", "Reported. Support will review it and the payment stays frozen until they decide.", reason.trim())}>
                      <Text style={styles.primaryText}>Send report</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  tabs: { flexDirection: "row", margin: 16, marginBottom: 8, backgroundColor: "#E5E7EB", borderRadius: 10, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: "#fff" },
  tabText: { fontSize: 13, color: "#6B7280", fontWeight: "600" },
  tabTextActive: { color: "#1B2A4A" },
  list: { padding: 16, paddingTop: 8 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  error: { color: "#DC2626", fontSize: 13, marginHorizontal: 16, marginBottom: 4 },
  notice: { color: "#166534", backgroundColor: "#F0FDF4", fontSize: 13, marginHorizontal: 16, marginBottom: 4, padding: 10, borderRadius: 8, overflow: "hidden" },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, fontWeight: "700", color: "#1B2A4A", fontSize: 15 },
  status: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  meta: { fontSize: 12, color: "#4B5563", marginTop: 4 },
  warn: { fontSize: 12, color: "#92400E", marginTop: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 10 },
  link: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", textDecorationLine: "underline" },
  linkDanger: { fontSize: 13, fontWeight: "700", color: "#B91C1C", textDecorationLine: "underline" },
  payRow: { marginTop: 10, gap: 8 },
  reportBox: { marginTop: 10, gap: 8 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: "#fff" },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  primaryText: { color: "#1B2A4A", fontWeight: "700" },
  disabled: { opacity: 0.5 },
});

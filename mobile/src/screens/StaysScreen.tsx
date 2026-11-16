import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, Alert } from "react-native";
import { listStays, stayAction, type StayActionName, type StayItem } from "../lib/api";
import {
  availableStayActions, cancelPrompt, localToday, STAY_STATUS_COLOR, STAY_STATUS_LABEL, visibleStays,
} from "../lib/stays";

type Role = "guest" | "host";

function day(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" });
}

const xaf = (value: string | number) => `${Number(value).toLocaleString()} XAF`;

/** Hotel and guest-house stays: as a guest, cancel (free until 48 hours before check-in), confirm the stay or report a
 * problem; as a host, check guests in and out, record no-shows or cancel. The server enforces every rule. */
export default function StaysScreen() {
  const [role, setRole] = useState<Role>("guest");
  const [stays, setStays] = useState<StayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async (which: Role) => {
    try {
      setStays(await listStays(which));
      setError("");
    } catch (err) {
      setStays([]);
      setError(err instanceof Error ? err.message : "Could not load your stays.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(role); }, [load, role]);

  async function run(id: string, action: StayActionName, success: string, why?: string) {
    setError("");
    setNotice("");
    try {
      await stayAction(id, action, why);
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

  function switchRole(next: Role) {
    setRole(next);
    setLoading(true);
    setError("");
    setNotice("");
    setReporting(null);
  }

  const today = localToday();
  const rows = visibleStays(stays, role, today);

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(["guest", "host"] as Role[]).map((value) => (
          <TouchableOpacity key={value} style={[styles.tab, role === value && styles.tabActive]} onPress={() => switchRole(value)}>
            <Text style={[styles.tabText, role === value && styles.tabTextActive]}>{value === "guest" ? "My stays" : "At my places"}</Text>
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
          ListEmptyComponent={<Text style={styles.empty}>{role === "guest" ? "You have no stays yet." : "Nobody has booked your hotels or guest houses yet."}</Text>}
          renderItem={({ item: s }) => {
            const actions = availableStayActions(s, role, today);
            return (
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.title}>{role === "guest" ? s.place_name || "Your stay" : s.guest_name}<Text style={styles.sub}> · {s.room_type_name}</Text></Text>
                  <Text style={[styles.status, { color: STAY_STATUS_COLOR[s.status] }]}>{STAY_STATUS_LABEL[s.status]}</Text>
                </View>
                <Text style={styles.meta}>
                  {day(s.check_in)} → {day(s.check_out)} · {s.adults + s.children} guests · {xaf(s.rate_xaf)}
                  {role === "host" && s.place_name ? ` · ${s.place_name}` : ""}
                </Text>
                {s.payment_held && s.payout_due_at ? (
                  <Text style={styles.meta}>
                    {role === "guest"
                      ? `Your payment is held safely. If you report no problem, the host is paid automatically on ${day(s.payout_due_at)}.`
                      : `The payment is held and is released to you on ${day(s.payout_due_at)} unless the guest reports a problem.`}
                  </Text>
                ) : null}

                <View style={styles.actions}>
                  {actions.includes("check-in") ? <TouchableOpacity onPress={() => run(s.id, "check-in", "Guest checked in.")}><Text style={styles.link}>Check in</Text></TouchableOpacity> : null}
                  {actions.includes("checkout") ? (
                    <TouchableOpacity onPress={() => confirmThen("Check out?", "Check this guest out? The payment is released to you.", () => run(s.id, "checkout", "Checked out. The payment was released to your wallet."))}>
                      <Text style={styles.link}>Check out</Text>
                    </TouchableOpacity>
                  ) : null}
                  {actions.includes("no-show") ? (
                    <TouchableOpacity onPress={() => confirmThen("Record a no-show?", "The guest never arrived. You keep the first night and the rest is refunded to them.", () => run(s.id, "no-show", "Recorded as a no-show."))}>
                      <Text style={styles.link}>Guest did not arrive</Text>
                    </TouchableOpacity>
                  ) : null}
                  {actions.includes("confirm-stay") ? (
                    <TouchableOpacity onPress={() => confirmThen("Confirm your stay?", "The host is paid at once and you can no longer report a problem.", () => run(s.id, "confirm-stay", "Thank you! The host has been paid."))}>
                      <Text style={styles.link}>Confirm it went well</Text>
                    </TouchableOpacity>
                  ) : null}
                  {actions.includes("report") ? <TouchableOpacity onPress={() => setReporting(reporting === s.id ? null : s.id)}><Text style={styles.linkDanger}>Report a problem</Text></TouchableOpacity> : null}
                  {actions.includes("cancel-unpaid") ? <TouchableOpacity onPress={() => run(s.id, "cancel", "The reservation was dropped.")}><Text style={styles.link}>Cancel (unpaid)</Text></TouchableOpacity> : null}
                  {actions.includes("cancel") ? (
                    <TouchableOpacity onPress={() => confirmThen("Cancel reservation?", cancelPrompt(s, role), () => run(s.id, "cancel", role === "host" ? "Cancelled and the guest was refunded." : "Your stay was cancelled."))}>
                      <Text style={styles.linkDanger}>{role === "host" ? "Cancel and refund" : "Cancel stay"}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {reporting === s.id ? (
                  <View style={styles.reportBox}>
                    <Text style={styles.meta}>What went wrong? Your payment stays frozen while support reviews it.</Text>
                    <TextInput style={[styles.input, { height: 80 }]} multiline value={reason} onChangeText={setReason} placeholder="Describe the problem" />
                    <TouchableOpacity style={[styles.primary, reason.trim().length < 5 && styles.disabled]} disabled={reason.trim().length < 5} onPress={() => run(s.id, "dispute", "Reported. Support will review it and the payment stays frozen until they decide.", reason.trim())}>
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
  sub: { fontWeight: "400", color: "#6B7280" },
  status: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  meta: { fontSize: 12, color: "#4B5563", marginTop: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 10 },
  link: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", textDecorationLine: "underline" },
  linkDanger: { fontSize: 13, fontWeight: "700", color: "#B91C1C", textDecorationLine: "underline" },
  reportBox: { marginTop: 10, gap: 8 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: "#fff" },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  primaryText: { color: "#1B2A4A", fontWeight: "700" },
  disabled: { opacity: 0.5 },
});

import { useState, useCallback, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Linking, Vibration } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  getAdminConsoleSummary, listAdminVerificationRequests, approveVerificationRequest, rejectVerificationRequest,
  listAdminContentReports, resolveContentReport,
  listAdminDisputeCases, respondToDispute, resolveDispute, listAdminSosRides, resolveAdminSosRide,
  AdminConsoleSummary, AdminVerificationRequest, AdminContentReport, AdminDisputeCase, AdminSosRide,
} from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "AdminConsole">;
type Tab = "summary" | "verifications" | "reports" | "disputes" | "sos";

/**
 * The mobile equivalent of the real admin console built on web this
 * session — every real queue an admin actually works through:
 * approve/reject verifications, resolve content reports (with a real
 * optional strike), respond to/resolve payment disputes.
 */
export default function AdminConsoleScreen({ navigation }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const [status, setStatus] = useState<"loading" | "signedOut" | "notAdmin" | "ready">("loading");
  const [summary, setSummary] = useState<AdminConsoleSummary | null>(null);
  const [verifications, setVerifications] = useState<AdminVerificationRequest[]>([]);
  const [reports, setReports] = useState<AdminContentReport[]>([]);
  const [disputes, setDisputes] = useState<AdminDisputeCase[]>([]);
  const [sosRides, setSosRides] = useState<AdminSosRide[]>([]);
  const seenSosRef = useRef<Set<string>>(new Set());

  const notifyNewSos = useCallback((incoming: AdminSosRide[]) => {
    for (const ride of incoming) {
      const key = `${ride.id}:${ride.sos_raised_at}`;
      if (!seenSosRef.current.has(key)) {
        seenSosRef.current.add(key);
        Vibration.vibrate([0, 400, 200, 400]);
        Notifications.scheduleNotificationAsync({
          content: {
            title: `🆘 OaziGo SOS — ${ride.raised_by?.name ?? "Ride Alert"}`,
            body: `${ride.pickup_description} → ${ride.dropoff_description}`,
            sound: true,
          },
          trigger: null,
        }).catch(() => {});
      }
    }
  }, []);

  const loadAll = useCallback(() => {
    SecureStore.getItemAsync("access_token").then(async (token) => {
      if (!token) {
        setStatus("signedOut");
        return;
      }
      try {
        const [summaryData, verificationsData, reportsData, disputesData, sosData] = await Promise.all([
          getAdminConsoleSummary(), listAdminVerificationRequests(), listAdminContentReports(), listAdminDisputeCases(),
          listAdminSosRides().catch(() => ({ count: 0, results: [] as AdminSosRide[] })),
        ]);
        setSummary(summaryData);
        setVerifications(verificationsData.results);
        setReports(reportsData.results);
        setDisputes(disputesData.results);
        setSosRides(sosData.results);
        notifyNewSos(sosData.results);
        setStatus("ready");
      } catch {
        setStatus("notAdmin");
      }
    });
  }, [notifyNewSos]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
      const interval = setInterval(() => {
        listAdminSosRides()
          .then((sosData) => {
            setSosRides(sosData.results);
            notifyNewSos(sosData.results);
          })
          .catch(() => {});
      }, 15000);
      return () => clearInterval(interval);
    }, [loadAll, notifyNewSos])
  );

  async function handleApprove(id: string) {
    const res = await approveVerificationRequest(id);
    if (!res.ok) return Alert.alert("That action failed", "Please try again.");
    loadAll();
  }

  async function handleReject(id: string) {
    // WHY not Alert.prompt: it's iOS-only and doesn't exist on Android
    // at all — a real cross-platform bug my first attempt at this had.
    // A simple confirm dialog with no reason text still lets the admin
    // reject; a fuller reason-entry UI is a natural follow-up.
    Alert.alert("Reject this request?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reject", style: "destructive", onPress: async () => {
          const res = await rejectVerificationRequest(id, "");
          if (!res.ok) return Alert.alert("That action failed", "Please try again.");
          loadAll();
        },
      },
    ]);
  }

  async function handleRespondDispute(id: string) {
    const res = await respondToDispute(id);
    if (!res.ok) return Alert.alert("That action failed", "Please try again.");
    loadAll();
  }

  async function handleResolveDispute(id: string, outcome: "RELEASE" | "REFUND") {
    const res = await resolveDispute(id, outcome, "");
    if (!res.ok) return Alert.alert("That action failed", "Please try again.");
    loadAll();
  }

  async function handleResolveSos(id: string) {
    const res = await resolveAdminSosRide(id);
    if (!res.ok) return Alert.alert("That action failed", "Please try again.");
    loadAll();
  }

  if (status === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.signInText}>Sign in to access the admin console</Text>
        <TouchableOpacity style={styles.signInButton} onPress={() => navigation.navigate("Login")}>
          <Text style={styles.signInButtonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === "notAdmin") {
    return (
      <View style={styles.centered}>
        <Text style={styles.notAdminText}>This account does not have admin access.</Text>
      </View>
    );
  }

  if (status === "loading" || !summary) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Admin Console</Text>

      <View style={styles.tabRow}>
        {([
          { key: "summary" as const, label: "Overview" },
          { key: "verifications" as const, label: `Verifications (${verifications.length})` },
          { key: "reports" as const, label: `Reports (${reports.length})` },
          { key: "disputes" as const, label: `Disputes (${disputes.length})` },
          { key: "sos" as const, label: `SOS (${sosRides.length})` },
        ]).map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabSelected]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextSelected]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "summary" && (
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Pending Verifications</Text>
            <Text style={styles.statValue}>{summary.pending_verification_requests}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Open Reports</Text>
            <Text style={styles.statValue}>{summary.open_content_reports}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Open Disputes</Text>
            <Text style={styles.statValue}>{summary.open_dispute_cases}</Text>
          </View>
        </View>
      )}

      {tab === "verifications" && (
        verifications.length === 0 ? <Text style={styles.empty}>Nothing here right now.</Text> :
        verifications.map((v) => (
          <View key={v.id} style={styles.card}>
            <Text style={styles.cardTitle}>{v.requester_name} — {v.request_type.replaceAll("_", " ")}</Text>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.approveButton} onPress={() => handleApprove(v.id)}>
                <Text style={styles.actionButtonText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rejectButton} onPress={() => handleReject(v.id)}>
                <Text style={styles.actionButtonText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      {tab === "reports" && (
        reports.length === 0 ? <Text style={styles.empty}>Nothing here right now.</Text> :
        reports.map((r) => (
          <ReportCard key={r.id} report={r} onResolve={(actionTaken, issueStrike) => resolveContentReport(r.id, actionTaken, issueStrike).then(loadAll)} />
        ))
      )}

      {tab === "sos" && (
        sosRides.length === 0 ? <Text style={styles.empty}>No open SOS alerts from OaziGo rides.</Text> :
        sosRides.map((ride) => (
          <View key={ride.id} style={[styles.card, { borderColor: "#FCA5A5" }]}>
            <Text style={styles.cardTitle}>🆘 {ride.raised_by?.name ?? "—"} ({ride.raised_by?.phone})</Text>
            <Text style={styles.cardSubtitle}>{new Date(ride.sos_raised_at).toLocaleString()}</Text>
            <Text style={styles.cardSubtitle}>{ride.pickup_description} → {ride.dropoff_description} · {ride.status.replace("_", " ")}</Text>
            {ride.sos_note ? <Text style={styles.cardTitle}>“{ride.sos_note}”</Text> : null}
            <Text style={styles.cardSubtitle}>
              Rider: {ride.rider?.name} ({ride.rider?.phone})
              {ride.driver ? ` · Driver: ${ride.driver.name} (${ride.driver.phone})` : ""}
              {ride.vehicle_details ? ` · ${ride.vehicle_details.make} ${ride.vehicle_details.model}, ${ride.vehicle_details.plate_number}` : ""}
            </Text>
            {ride.raised_by_contact ? <Text style={styles.cardSubtitle}>Emergency contact: {ride.raised_by_contact.name} ({ride.raised_by_contact.phone})</Text> : null}
            <View style={styles.actionRow}>
              {ride.sos_latitude && ride.sos_longitude ? (
                <TouchableOpacity style={styles.neutralButton} onPress={() => Linking.openURL(`https://www.google.com/maps?q=${ride.sos_latitude},${ride.sos_longitude}`)}>
                  <Text style={styles.actionButtonTextDark}>Open map</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.cardSubtitle}>No location shared</Text>
              )}
              <TouchableOpacity style={styles.approveButton} onPress={() => handleResolveSos(ride.id)}>
                <Text style={styles.actionButtonText}>Mark handled</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}

      {tab === "disputes" && (
        disputes.length === 0 ? <Text style={styles.empty}>Nothing here right now.</Text> :
        disputes.map((d) => (
          <View key={d.id} style={styles.card}>
            <Text style={styles.cardTitle}>{d.raised_by_name} — {d.status}</Text>
            <Text style={styles.cardSubtitle}>{d.reason}</Text>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.neutralButton} onPress={() => handleRespondDispute(d.id)}>
                <Text style={styles.actionButtonTextDark}>Respond</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.approveButton} onPress={() => handleResolveDispute(d.id, "RELEASE")}>
                <Text style={styles.actionButtonText}>Release</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rejectButton} onPress={() => handleResolveDispute(d.id, "REFUND")}>
                <Text style={styles.actionButtonText}>Refund</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function ReportCard({ report, onResolve }: { report: AdminContentReport; onResolve: (actionTaken: string, issueStrike: boolean) => void }) {
  const [actionTaken, setActionTaken] = useState("");
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{report.reason.replaceAll("_", " ")}</Text>
      <Text style={styles.cardSubtitle}>Reported by {report.reported_by_name}</Text>
      <TextInput style={styles.input} placeholder="What action did you take?" value={actionTaken} onChangeText={setActionTaken} />
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.neutralButton} onPress={() => actionTaken && onResolve(actionTaken, false)}>
          <Text style={styles.actionButtonTextDark}>Dismiss</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rejectButton} onPress={() => actionTaken && onResolve(actionTaken, true)}>
          <Text style={styles.actionButtonText}>Resolve + Strike</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  signInText: { color: "#6B7280", fontSize: 14, marginBottom: 16, textAlign: "center" },
  signInButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
  signInButtonText: { color: "#fff", fontWeight: "700" },
  notAdminText: { color: "#6B7280", fontSize: 14, textAlign: "center" },
  title: { fontSize: 22, fontWeight: "bold", color: "#1B2A4A", marginBottom: 16 },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: "#F3F4F6" },
  tabSelected: { backgroundColor: "#1B2A4A" },
  tabText: { color: "#374151", fontSize: 12, fontWeight: "600" },
  tabTextSelected: { color: "#fff" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: { flex: 1, minWidth: "45%", backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 14 },
  statLabel: { fontSize: 11, color: "#6B7280", marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: "bold", color: "#1B2A4A" },
  empty: { color: "#6B7280", textAlign: "center", marginTop: 20 },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 14, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#1B2A4A" },
  cardSubtitle: { fontSize: 12, color: "#6B7280", marginTop: 2, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 6, padding: 8, fontSize: 13, marginBottom: 8 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  approveButton: { backgroundColor: "#15803D", borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12 },
  rejectButton: { backgroundColor: "#DC2626", borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12 },
  neutralButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 6, paddingVertical: 8, paddingHorizontal: 12 },
  actionButtonText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  actionButtonTextDark: { color: "#1B2A4A", fontSize: 11, fontWeight: "700" },
});

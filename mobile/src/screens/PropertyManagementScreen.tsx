import { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import {
  listMaintenanceRequests, closeMaintenanceRequest, listTenantScreenings, consentToScreening, generateScreeningReport,
  listSafetyCheckIns, checkOutSafely, type MaintenanceRequestItem, type TenantScreeningItem, type SafetyCheckInItem,
} from "../lib/api";

type Tab = "maintenance" | "screening" | "safety";

/**
 * Property Management — mobile parity with the web app's
 * /property-management page, same session. Real maintenance,
 * consent-gated tenant screening, and agent safety check-ins.
 */
export default function PropertyManagementScreen() {
  const [tab, setTab] = useState<Tab>("maintenance");
  const [loading, setLoading] = useState(true);
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequestItem[]>([]);
  const [screenings, setScreenings] = useState<TenantScreeningItem[]>([]);
  const [checkIns, setCheckIns] = useState<SafetyCheckInItem[]>([]);

  const load = useCallback(() => {
    Promise.all([listMaintenanceRequests(), listTenantScreenings(), listSafetyCheckIns()])
      .then(([m, s, c]) => {
        setMaintenanceRequests(m.results);
        setScreenings(s.results);
        setCheckIns(c.results);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleClose(id: string) { await closeMaintenanceRequest(id); load(); }
  async function handleConsent(id: string) { await consentToScreening(id); load(); }
  async function handleGenerateReport(id: string) { await generateScreeningReport(id); load(); }
  async function handleCheckOut(id: string) { await checkOutSafely(id); load(); }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.tabRow}>
        {(["maintenance", "screening", "safety"] as const).map((key) => (
          <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {key === "maintenance" ? "Maintenance" : key === "screening" ? "Screening" : "Safety"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {tab === "maintenance" && (
          maintenanceRequests.length === 0 ? <Text style={styles.empty}>No maintenance requests yet.</Text> :
          maintenanceRequests.map((req) => (
            <View key={req.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.category}>{req.category}</Text>
                <View style={[styles.statusBadge, req.status === "CLOSED" ? styles.statusGreen : styles.statusGold]}>
                  <Text style={styles.statusBadgeText}>{req.status}</Text>
                </View>
              </View>
              <Text style={styles.description}>{req.description}</Text>
              {req.cost_estimate_xaf && <Text style={styles.cost}>Total cost: {Number(req.cost_estimate_xaf).toLocaleString()} XAF</Text>}
              {req.status !== "CLOSED" && (
                <TouchableOpacity onPress={() => handleClose(req.id)}><Text style={styles.actionLink}>Mark as Closed</Text></TouchableOpacity>
              )}
            </View>
          ))
        )}

        {tab === "screening" && (
          screenings.length === 0 ? <Text style={styles.empty}>No tenant screening requests yet.</Text> :
          screenings.map((s) => (
            <View key={s.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.category}>{s.prospective_tenant_name}</Text>
                <View style={[styles.statusBadge, s.status === "COMPLETED" ? styles.statusGreen : styles.statusGold]}>
                  <Text style={styles.statusBadgeText}>{s.status}</Text>
                </View>
              </View>
              {s.report_summary && (
                <View style={{ marginBottom: 6 }}>
                  <Text style={styles.reportLine}>Completed bookings: {s.report_summary.completed_bookings}</Text>
                  <Text style={styles.reportLine}>Warnings: {s.report_summary.warning_count}</Text>
                </View>
              )}
              {s.status === "PENDING_CONSENT" && (
                <TouchableOpacity onPress={() => handleConsent(s.id)}><Text style={styles.actionLink}>Grant Consent</Text></TouchableOpacity>
              )}
              {s.status === "CONSENTED" && (
                <TouchableOpacity onPress={() => handleGenerateReport(s.id)}><Text style={styles.actionLink}>Generate Report</Text></TouchableOpacity>
              )}
            </View>
          ))
        )}

        {tab === "safety" && (
          checkIns.length === 0 ? <Text style={styles.empty}>No safety check-ins yet.</Text> :
          checkIns.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.category}>{c.emergency_contact_name}</Text>
                <View style={[styles.statusBadge, c.status === "ACTIVE" ? styles.statusGold : styles.statusGreen]}>
                  <Text style={styles.statusBadgeText}>{c.status}</Text>
                </View>
              </View>
              <Text style={styles.reportLine}>Expected check-out by {new Date(c.expected_checkout_at).toLocaleString()}</Text>
              {c.status === "ACTIVE" && (
                <TouchableOpacity onPress={() => handleCheckOut(c.id)}><Text style={styles.actionLink}>Check Out Now</Text></TouchableOpacity>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  tabRow: { flexDirection: "row", padding: 16, paddingBottom: 8, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "#F3F4F6" },
  tabActive: { backgroundColor: "#1B2A4A" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  tabTextActive: { color: "#fff" },
  list: { padding: 16, paddingTop: 8 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  category: { fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusGold: { backgroundColor: "#C9A227" },
  statusGreen: { backgroundColor: "#16A34A" },
  statusBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  description: { fontSize: 13, color: "#374151", marginBottom: 6 },
  cost: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginBottom: 6 },
  reportLine: { fontSize: 12, color: "#6B7280" },
  actionLink: { fontSize: 12, color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline", marginTop: 4 },
});

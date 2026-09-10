import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { getMyTechnicianDashboard, type TechnicianDashboardData } from "../lib/api";

/** Technician Dashboard — mobile parity with the web app's /technician-dashboard page. */
export default function TechnicianDashboardScreen() {
  const [data, setData] = useState<TechnicianDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyTechnicianDashboard().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }
  if (!data) {
    return <View style={styles.centered}><Text style={styles.empty}>Sign in to view your dashboard.</Text></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{data.active_job_count}</Text>
          <Text style={styles.statLabel}>Active Jobs</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{data.completed_job_count}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
      </View>

      <View style={styles.walletCard}>
        <Text style={styles.walletLabel}>Wallet Balance</Text>
        <Text style={styles.walletValue}>{Number(data.wallet_balance_xaf).toLocaleString()} XAF</Text>
      </View>

      <View style={styles.trendCard}>
        <Text style={styles.trendLabel}>Jobs This Period</Text>
        <Text style={styles.trendValue}>
          {data.jobs_trend.percent_change === null ? "New — no history yet" : `${data.jobs_trend.percent_change > 0 ? "+" : ""}${data.jobs_trend.percent_change}% vs. last period`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { color: "#6B7280" },
  container: { padding: 16 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  statBox: { flex: 1, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, alignItems: "center" },
  statValue: { fontSize: 24, fontWeight: "700", color: "#1B2A4A" },
  statLabel: { fontSize: 11, color: "#6B7280", marginTop: 2 },
  walletCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, marginBottom: 12 },
  walletLabel: { fontSize: 11, color: "#6B7280", marginBottom: 4 },
  walletValue: { fontSize: 22, fontWeight: "700", color: "#1B2A4A" },
  trendCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16 },
  trendLabel: { fontSize: 11, color: "#6B7280", marginBottom: 4 },
  trendValue: { fontSize: 14, color: "#374151" },
});

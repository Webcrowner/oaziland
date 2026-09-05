import { useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getMyAgentDashboard, AgentDashboard } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "AgentDashboard">;

/**
 * A real gap this closes: get_agent_private_dashboard() had real,
 * tested aggregation logic and a real web page — the founder's own
 * 'well and professionally made' private space, since he's an agent
 * and agency owner himself — but no mobile UI.
 */
export default function AgentDashboardScreen({ navigation }: Props) {
  const [dashboard, setDashboard] = useState<AgentDashboard | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "notAgent" | "ready">("loading");

  useFocusEffect(
    useCallback(() => {
      SecureStore.getItemAsync("access_token").then(async (token) => {
        if (!token) {
          setStatus("signedOut");
          return;
        }
        try {
          const data = await getMyAgentDashboard();
          setDashboard(data);
          setStatus("ready");
        } catch {
          setStatus("notAgent");
        }
      });
    }, [])
  );

  if (status === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.signInText}>Sign in to view your dashboard</Text>
        <TouchableOpacity style={styles.signInButton} onPress={() => navigation.navigate("Login")}>
          <Text style={styles.signInButtonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === "notAgent") {
    return (
      <View style={styles.centered}>
        <Text style={styles.notAgentText}>This account is not registered as an agent.</Text>
      </View>
    );
  }

  if (status === "loading" || !dashboard) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
  }

  const trend = dashboard.commission_trend_xaf;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>My Dashboard</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Performance Score</Text>
          <Text style={styles.statValue}>{dashboard.performance_score}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Open Enquiries</Text>
          <Text style={styles.statValue}>{dashboard.open_enquiries}</Text>
        </View>
      </View>

      <View style={styles.statCardWide}>
        <Text style={styles.statLabel}>Commission This Period</Text>
        <Text style={styles.statValue}>{Number(trend.current_period_value).toLocaleString()} XAF</Text>
        <Text style={styles.statSub}>
          {trend.percent_change === null
            ? "New — no history yet"
            : `${trend.percent_change > 0 ? "+" : ""}${trend.percent_change}% vs. last period`}
        </Text>
      </View>

      {dashboard.is_agency_owner && (
        <>
          <Text style={styles.sectionTitle}>Agency Overview</Text>
          <View style={styles.statCardWide}>
            <Text style={styles.statLabel}>Team Members</Text>
            {dashboard.agency_roster?.map((member) => (
              <Text key={member.user__username} style={styles.rosterMember}>{member.user__username}</Text>
            ))}
          </View>
          <View style={styles.statCardWide}>
            <Text style={styles.statLabel}>Total Agency Commission</Text>
            <Text style={styles.statValue}>{Number(dashboard.agency_aggregated_commission_xaf || 0).toLocaleString()} XAF</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  signInText: { color: "#6B7280", fontSize: 14, marginBottom: 16, textAlign: "center" },
  signInButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 24 },
  signInButtonText: { color: "#fff", fontWeight: "700" },
  notAgentText: { color: "#6B7280", fontSize: 14, textAlign: "center" },
  title: { fontSize: 22, fontWeight: "bold", color: "#1B2A4A", marginBottom: 20 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 14 },
  statCardWide: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 14, marginBottom: 12 },
  statLabel: { fontSize: 11, color: "#6B7280", marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: "bold", color: "#1B2A4A" },
  statSub: { fontSize: 11, color: "#9CA3AF", marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginTop: 12, marginBottom: 10 },
  rosterMember: { fontSize: 13, color: "#374151", marginTop: 2 },
});

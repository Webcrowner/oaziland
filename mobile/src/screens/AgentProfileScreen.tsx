import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getAgentPublicProfile, type AgentPublicProfile } from "../lib/api";
import RateAndReport from "../components/RateAndReport";

type Props = NativeStackScreenProps<RootStackParamList, "AgentProfile">;

/** Agent profile — mobile parity with the web app's /agents/[id] page. */
export default function AgentProfileScreen({ route }: Props) {
  const { agentId } = route.params;
  const [profile, setProfile] = useState<AgentPublicProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAgentPublicProfile(agentId).then(setProfile).catch(() => {}).finally(() => setLoading(false));
  }, [agentId]);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }
  if (!profile) {
    return <View style={styles.centered}><Text style={styles.empty}>This agent could not be found.</Text></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{profile.full_name.charAt(0).toUpperCase()}</Text></View>
      <Text style={styles.name}>{profile.full_name}</Text>
      {profile.agency_name ? <Text style={styles.agency}>{profile.agency_name}</Text> : null}
      {profile.is_kyc_verified && <Text style={styles.verified}>✓ Verified</Text>}
      {profile.average_rating ? <Text style={styles.rating}>★ {profile.average_rating} ({profile.rating_count} ratings)</Text> : null}
      <Text style={styles.listings}>{profile.active_listing_count} active listing{profile.active_listing_count === 1 ? "" : "s"}</Text>

      <View style={styles.divider} />
      <RateAndReport subjectUserId={agentId} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { color: "#6B7280" },
  container: { padding: 24, alignItems: "center" },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center", marginBottom: 12 },
  avatarText: { fontSize: 26, fontWeight: "700", color: "#1B2A4A" },
  name: { fontSize: 20, fontWeight: "700", color: "#1B2A4A" },
  agency: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  verified: { fontSize: 13, color: "#16A34A", fontWeight: "600", marginTop: 6 },
  rating: { fontSize: 15, color: "#C9A227", fontWeight: "700", marginTop: 6 },
  listings: { fontSize: 13, color: "#374151", marginTop: 6 },
  divider: { height: 1, backgroundColor: "#E5E7EB", width: "100%", marginVertical: 16 },
});

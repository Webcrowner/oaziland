import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getAgencyPublicProfile, type AgencyDirectoryEntry } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "AgencyProfile">;

/**
 * Agency profile — mobile parity with the web app's /agencies/[id]
 * page. No RateAndReport here, same as web: an agency's rating is a
 * real aggregate across every agent on its roster, not a single
 * ratable entity.
 */
export default function AgencyProfileScreen({ route }: Props) {
  const { agencyId } = route.params;
  const [profile, setProfile] = useState<AgencyDirectoryEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAgencyPublicProfile(agencyId).then(setProfile).catch(() => {}).finally(() => setLoading(false));
  }, [agencyId]);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }
  if (!profile) {
    return <View style={styles.centered}><Text style={styles.empty}>This agency could not be found.</Text></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{profile.agency_name.charAt(0).toUpperCase()}</Text></View>
      <Text style={styles.name}>{profile.agency_name}</Text>
      <Text style={styles.reg}>{profile.registration_number}</Text>
      {profile.average_rating ? <Text style={styles.rating}>★ {profile.average_rating} ({profile.rating_count} ratings)</Text> : <Text style={styles.noRating}>No ratings yet</Text>}

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{profile.agent_count}</Text>
          <Text style={styles.statLabel}>Agent{profile.agent_count === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{profile.active_listing_count}</Text>
          <Text style={styles.statLabel}>Active Listing{profile.active_listing_count === 1 ? "" : "s"}</Text>
        </View>
      </View>
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
  reg: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  rating: { fontSize: 15, color: "#C9A227", fontWeight: "700", marginTop: 8 },
  noRating: { fontSize: 13, color: "#6B7280", marginTop: 8 },
  statsRow: { flexDirection: "row", gap: 16, marginTop: 20, width: "100%" },
  statBox: { flex: 1, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 14, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "700", color: "#1B2A4A" },
  statLabel: { fontSize: 11, color: "#6B7280", marginTop: 2 },
});

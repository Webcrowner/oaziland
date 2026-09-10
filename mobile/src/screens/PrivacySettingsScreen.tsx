import { useState, useEffect } from "react";
import { View, Text, Switch, StyleSheet, ActivityIndicator } from "react-native";
import { getMyPresenceSettings, updateMyPresenceSettings, type PresenceSettings } from "../lib/api";

/** Privacy Settings — mobile parity with the web app's /privacy-settings page. */
export default function PrivacySettingsScreen() {
  const [settings, setSettings] = useState<PresenceSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getMyPresenceSettings().then(setSettings).catch(() => {});
  }, []);

  async function handleToggle(field: keyof PresenceSettings) {
    if (!settings) return;
    const updated = { ...settings, [field]: !settings[field] };
    setSettings(updated);
    await updateMyPresenceSettings({ [field]: updated[field] });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!settings) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Privacy Settings</Text>
      <Text style={styles.subtitle}>Control what other people can see about you.</Text>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Online Status</Text>
          <Text style={styles.description}>Let others see when you're online.</Text>
        </View>
        <Switch value={settings.show_online_status} onValueChange={() => handleToggle("show_online_status")} />
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Typing Indicator</Text>
          <Text style={styles.description}>Let others see when you're typing.</Text>
        </View>
        <Switch value={settings.show_typing_indicator} onValueChange={() => handleToggle("show_typing_indicator")} />
      </View>

      {saved && <Text style={styles.savedText}>✓ Saved</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { padding: 20 },
  title: { fontSize: 20, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#6B7280", marginBottom: 20 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: "700", color: "#1B2A4A" },
  description: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  savedText: { color: "#16A34A", fontSize: 13, textAlign: "center", marginTop: 8 },
});

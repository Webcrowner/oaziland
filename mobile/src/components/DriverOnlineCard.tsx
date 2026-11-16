import { useEffect, useRef, useState } from "react";
import { View, Text, Switch, StyleSheet, ActivityIndicator } from "react-native";
import * as Location from "expo-location";
import { setDriverLocation, type DriverProfileItem } from "../lib/api";
import { getCurrentCoords } from "../lib/location";
import { registerDeviceForPush } from "../lib/pushNotifications";
import { useI18n } from "../i18n";

const SEND_EVERY_MS = 10_000;

/**
 * Sends the driver's position while they're online or on a trip, so matching can find them and riders can
 * follow the car. Without a background-location task this only runs while the app is open.
 */
export function useDriverLocationSharing(sharing: boolean) {
  const lastSent = useRef(0);

  useEffect(() => {
    if (!sharing) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: SEND_EVERY_MS, distanceInterval: 20 },
          (pos) => {
            const now = Date.now();
            if (now - lastSent.current < SEND_EVERY_MS) return;
            lastSent.current = now;
            setDriverLocation({ latitude: Number(pos.coords.latitude.toFixed(7)), longitude: Number(pos.coords.longitude.toFixed(7)) }).catch(() => {});
          },
        );
        if (cancelled) subscription.remove();
      } catch {
        // No location service: the driver simply isn't placed on the map.
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [sharing]);
}

/** The verified driver's "go online" switch. Online drivers with a fresh position get ride offers from automatic matching. */
export default function DriverOnlineCard({
  driverProfile, hasVehicle, onChanged,
}: {
  driverProfile: DriverProfileItem;
  hasVehicle: boolean;
  onChanged: (profile: DriverProfileItem) => void;
}) {
  const { t } = useI18n();
  const online = Boolean(driverProfile.is_online);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");

  async function toggle(next: boolean) {
    if (busy) return;
    if (next && !hasVehicle) {
      setWarning(t("oazigo.onlineNeedsVehicle"));
      return;
    }
    setBusy(true);
    setWarning("");
    setError("");
    try {
      // Send the position with the switch so this driver can be matched straight away.
      const coords = next ? await getCurrentCoords() : null;
      const profile = await setDriverLocation(coords ? { is_online: next, ...roundCoords(coords) } : { is_online: next });
      onChanged(profile);
      if (next) {
        if (!coords) setWarning(t("oazigo.onlineNoLocation"));
        registerDeviceForPush().catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.actionFailedBody"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, online ? styles.cardOnline : null]}>
      <View style={styles.row}>
        <View style={[styles.dot, online ? styles.dotOnline : null]} />
        <View style={styles.texts}>
          <Text style={styles.title}>{online ? t("oazigo.onlineTitle") : t("oazigo.offlineTitle")}</Text>
          <Text style={styles.hint}>{online ? t("oazigo.onlineHint") : t("oazigo.offlineHint")}</Text>
        </View>
        {busy ? (
          <ActivityIndicator color="#1B2A4A" />
        ) : (
          <Switch
            accessibilityLabel={t("oazigo.onlineSwitchLabel")}
            value={online}
            onValueChange={toggle}
            trackColor={{ true: "#16A34A", false: "#D1D5DB" }}
          />
        )}
      </View>
      {warning ? <Text style={styles.warning}>{warning}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function roundCoords(coords: { latitude: number; longitude: number }) {
  return { latitude: Number(coords.latitude.toFixed(7)), longitude: Number(coords.longitude.toFixed(7)) };
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB", borderRadius: 14, padding: 12, marginVertical: 10 },
  cardOnline: { borderColor: "#86EFAC", backgroundColor: "#F0FDF4" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#9CA3AF" },
  dotOnline: { backgroundColor: "#16A34A" },
  texts: { flex: 1 },
  title: { fontSize: 15, fontWeight: "800", color: "#1B2A4A" },
  hint: { fontSize: 12, color: "#4B5563", marginTop: 2 },
  warning: { marginTop: 8, fontSize: 12, color: "#92400E", backgroundColor: "#FEF3C7", borderRadius: 8, padding: 8 },
  error: { marginTop: 8, fontSize: 12, color: "#B91C1C", backgroundColor: "#FEE2E2", borderRadius: 8, padding: 8 },
});

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator, AppState, Vibration } from "react-native";
import { acceptRide, declineRideOffer, getMyRideOffer, vehiclesForRide, type RideOfferItem, type VehicleItem } from "../lib/api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

const POLL_MS = 4000;

/**
 * The ride automatic matching offers this online driver, with a countdown to accept or decline. Push
 * notifications bring the driver back to the app; while it's open the offer is also checked every few seconds.
 */
export default function RideOfferModal({
  active, vehicles, onAccepted,
}: {
  active: boolean;
  vehicles: VehicleItem[];
  onAccepted: () => void;
}) {
  const { t, locale } = useI18n();
  const [offer, setOffer] = useState<RideOfferItem | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [offerSeconds, setOfferSeconds] = useState(20);
  const [now, setNow] = useState(() => Date.now());
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownRideId = useRef<string | null>(null);

  const check = useCallback(async () => {
    try {
      const data = await getMyRideOffer();
      const next = data.offer;
      if (next && next.ride.id !== shownRideId.current) {
        shownRideId.current = next.ride.id;
        setError("");
        setVehicleId(null);
        Vibration.vibrate([0, 300, 150, 300]);
      }
      if (!next) shownRideId.current = null;
      setOffer(next);
      setOfferSeconds(data.offer_seconds);
      // Count down from the server's figure so a wrong phone clock can't shorten or stretch it.
      if (next) setDeadline(Date.now() + next.seconds_left * 1000);
    } catch {
      // A failed check is retried on the next tick.
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setOffer(null);
      return;
    }
    void check();
    let poll: ReturnType<typeof setInterval> | null = setInterval(check, POLL_MS);
    // Check at once when the driver comes back to the app (e.g. by tapping the push).
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void check();
        if (!poll) poll = setInterval(check, POLL_MS);
      } else if (poll) {
        clearInterval(poll);
        poll = null;
      }
    });
    return () => {
      if (poll) clearInterval(poll);
      subscription.remove();
    };
  }, [active, check]);

  useEffect(() => {
    if (!offer) return;
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, [offer]);

  if (!active || !offer) return null;

  const ride = offer.ride;
  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000));
  const fitting = vehiclesForRide(vehicles, ride);
  const chosen = vehicleId ?? fitting[0]?.id ?? null;
  const progress = Math.min(1, secondsLeft / Math.max(offerSeconds, 1));

  async function respond(accept: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (accept) {
        if (!chosen) return;
        await acceptRide(ride.id, chosen);
        setOffer(null);
        onAccepted();
      } else {
        await declineRideOffer(ride.id);
        setOffer(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("oazigo.offerTaken"));
      void check();
    } finally {
      setBusy(false);
    }
  }

  return (
    // Android's back button doesn't decline: the offer simply runs out, as on other driver apps.
    <Modal visible transparent animationType="slide" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.track}><View style={[styles.bar, { width: `${progress * 100}%` }]} /></View>
          <View style={styles.body}>
            <View style={styles.header}>
              <Text style={styles.title}>{t("oazigo.offerTitle")}</Text>
              <Text style={[styles.countdown, secondsLeft <= 5 ? styles.countdownUrgent : null]}>
                {t("oazigo.offerCountdown", { seconds: secondsLeft })}
              </Text>
            </View>
            <Text style={styles.route}>{ride.pickup_description} → {ride.dropoff_description}</Text>
            <Text style={styles.fare}>
              {Number(ride.fare_estimate_xaf).toLocaleString(locale)} XAF
              {ride.distance_km ? <Text style={styles.distance}>  · {Number(ride.distance_km).toLocaleString(locale)} km</Text> : null}
            </Text>
            <View style={styles.badges}>
              {ride.pickup_distance_km !== null ? <Text style={[styles.badge, styles.badgeGreen]}>{t("oazigo.offerAway", { km: ride.pickup_distance_km })}</Text> : null}
              <Text style={styles.badge}>{t(`category.${ride.ride_category}` as MessageKey)}</Text>
              {ride.transport_type === "CARGO" ? <Text style={[styles.badge, styles.badgeGold]}>{t("oazigo.cargoBadge")}</Text> : null}
              {ride.has_luggage ? <Text style={styles.badge}>{t("oazigo.luggageBadge")}</Text> : null}
            </View>
            {ride.cargo_description ? <Text style={styles.note}>{ride.cargo_description}</Text> : null}

            {fitting.length > 1 ? (
              <View>
                <Text style={styles.label}>{t("oazigo.offerVehicle")}</Text>
                <View style={styles.badges}>
                  {fitting.map((v) => (
                    <TouchableOpacity key={v.id} style={[styles.chip, chosen === v.id ? styles.chipActive : null]} onPress={() => setVehicleId(v.id)}>
                      <Text style={[styles.chipText, chosen === v.id ? styles.chipTextActive : null]}>{v.make} {v.model} · {v.plate_number}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.decline, busy ? styles.disabled : null]} onPress={() => respond(false)} disabled={busy}>
                <Text style={styles.declineText}>{t("oazigo.offerDecline")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.accept, busy || !chosen || secondsLeft === 0 ? styles.disabled : null]}
                onPress={() => respond(true)}
                disabled={busy || !chosen || secondsLeft === 0}
              >
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.acceptText}>{t("oazigo.offerAccept")}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  track: { height: 6, backgroundColor: "#F1F5F9" },
  bar: { height: 6, backgroundColor: "#F59E0B" },
  body: { padding: 20, paddingBottom: 32 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontWeight: "900", color: "#0F172A" },
  countdown: { fontSize: 13, fontWeight: "900", color: "#78350F", backgroundColor: "#FEF3C7", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden" },
  countdownUrgent: { color: "#B91C1C", backgroundColor: "#FEE2E2" },
  route: { marginTop: 12, fontSize: 15, fontWeight: "700", color: "#0F172A" },
  fare: { marginTop: 6, fontSize: 26, fontWeight: "900", color: "#0F172A" },
  distance: { fontSize: 13, fontWeight: "700", color: "#94A3B8" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  badge: { fontSize: 12, fontWeight: "700", color: "#334155", backgroundColor: "#F1F5F9", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden" },
  badgeGreen: { color: "#166534", backgroundColor: "#DCFCE7" },
  badgeGold: { color: "#78350F", backgroundColor: "#FEF3C7" },
  note: { marginTop: 8, fontSize: 12, color: "#64748B" },
  label: { marginTop: 12, fontSize: 12, fontWeight: "700", color: "#475569" },
  chip: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipText: { fontSize: 12, color: "#334155" },
  chipTextActive: { color: "#FFFFFF", fontWeight: "700" },
  error: { marginTop: 10, fontSize: 12, color: "#B91C1C", backgroundColor: "#FEE2E2", borderRadius: 8, padding: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 18 },
  decline: { flex: 1, borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  declineText: { fontSize: 15, fontWeight: "700", color: "#334155" },
  accept: { flex: 2, backgroundColor: "#16A34A", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  acceptText: { fontSize: 15, fontWeight: "900", color: "#FFFFFF" },
  disabled: { opacity: 0.5 },
});

import { useState, useEffect, useCallback, useLayoutEffect } from "react";
import { usePollWhile } from "../lib/usePollWhile";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Switch, ScrollView, Alert } from "react-native";
import {
  listMyRides, requestRide, acceptRide, startRide, completeRide, cancelRide, releaseRide, raiseRideSos, getMyUserId,
  getMyDriverProfile, registerAsDriver, listMyVehicles, registerVehicle, driverEarnings, canReportRideIssue,
  RIDE_CANCEL_REASONS, RIDE_RELEASE_REASONS, quoteRide,
  type RideBookingItem, type DriverProfileItem, type VehicleItem, type RideCancelReason, type RideReleaseReason, type RidePoints, type RideQuote,
} from "../lib/api";
import RidePlaceField, { type RidePoint } from "../components/RidePlaceField";
import RateAndReport from "../components/RateAndReport";
import EmergencyContactCard from "../components/EmergencyContactCard";
import RideReasonPicker from "../components/RideReasonPicker";
import RideIssueReport from "../components/RideIssueReport";
import WalletPayoutCard from "../components/WalletPayoutCard";
import DriverOnlineCard, { useDriverLocationSharing } from "../components/DriverOnlineCard";
import RideOfferModal from "../components/RideOfferModal";
import { getCurrentCoords } from "../lib/location";
import { useNavigation } from "@react-navigation/native";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import LanguageToggle from "../components/LanguageToggle";

const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#C9A227", ACCEPTED: "#1B2A4A", IN_PROGRESS: "#1B2A4A", COMPLETED: "#16A34A", CANCELLED: "#A8502E",
};
const RIDE_CATEGORIES = ["MOTO", "STANDARD", "COMFORT", "VAN", "TRUCK"];
// Shown with the "category.*" messages.

/**
 * OaziGo — Oaziland's own-branded ride and transport service, per
 * the founder's explicit naming. Mobile parity with the web app's
 * /oazigo page, same session: real vehicle categories (the same
 * tiered choice Yango already offers, each with its own real fare),
 * real cargo/building-materials transport for the platform's own
 * real estate use case, luggage, and — the deepest gap closed here —
 * real driver and vehicle registration. Previously any signed-in
 * user could accept a ride with zero vetting; now requires a real,
 * admin-verified DriverProfile and a registered Vehicle whose
 * category genuinely matches the ride.
 */
export default function OaziGoScreen() {
  const { t, locale } = useI18n();
  const navigation = useNavigation();
  useLayoutEffect(() => { navigation.setOptions({ title: t("oazigo.title") }); }, [navigation, t]);
  const categoryLabel = (code: string) => t(`category.${code}` as MessageKey);
  const [rides, setRides] = useState<RideBookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [driverProfile, setDriverProfile] = useState<DriverProfileItem | null>(null);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [pickupPoint, setPickupPoint] = useState<RidePoint>(null);
  const [dropoffPoint, setDropoffPoint] = useState<RidePoint>(null);
  const [quoteResult, setQuoteResult] = useState<{ key: string; quote: RideQuote | null } | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [rideCategory, setRideCategory] = useState("STANDARD");
  const [transportType, setTransportType] = useState<"PASSENGER" | "CARGO">("PASSENGER");
  const [hasLuggage, setHasLuggage] = useState(false);
  const [cargoDescription, setCargoDescription] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");

  const [showDriverForm, setShowDriverForm] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [vehicleCategory, setVehicleCategory] = useState("STANDARD");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [plateNumber, setPlateNumber] = useState("");

  const [acceptingRideId, setAcceptingRideId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [awaitingRideId, setAwaitingRideId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [asking, setAsking] = useState<{ id: string; kind: "cancel" | "release" } | null>(null);

  const load = useCallback(() => {
    Promise.all([
      listMyRides(),
      getMyDriverProfile().catch(() => null),
      listMyVehicles().catch(() => ({ results: [] as VehicleItem[] })),
    ]).then(([ridesData, driverData, vehiclesData]) => {
      setRides(ridesData.results);
      setDriverProfile(driverData);
      setVehicles(vehiclesData.results);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { getMyUserId().then(setMyUserId).catch(() => {}); }, []);

  const points: RidePoints | null = pickupPoint && dropoffPoint
    ? { pickup_latitude: pickupPoint.latitude, pickup_longitude: pickupPoint.longitude, dropoff_latitude: dropoffPoint.latitude, dropoff_longitude: dropoffPoint.longitude }
    : null;
  const quoteKey = points ? `${Object.values(points).join(",")}#${quoteAttempt}` : "";
  // A result only counts for the points (and retry) it was fetched for.
  const currentQuote = quoteResult && quoteResult.key === quoteKey ? quoteResult : null;
  const quote = currentQuote?.quote ?? null;
  const quoteFailed = Boolean(currentQuote && !currentQuote.quote);
  const quoting = Boolean(points) && !currentQuote;

  // The price comes from the server's road route between the two points.
  useEffect(() => {
    if (!points) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      quoteRide(points, controller.signal)
        .then((result) => setQuoteResult({ key: quoteKey, quote: result }))
        .catch(() => { if (!controller.signal.aborted) setQuoteResult({ key: quoteKey, quote: null }); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
    // quoteKey stands for the four coordinates and the retry count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  async function handleRequest() {
    if (!points || !quote) return;
    setRequesting(true);
    setRequestError("");
    try {
      await requestRide({
        pickup_description: pickup, dropoff_description: dropoff, ...points,
        ride_category: rideCategory, transport_type: transportType, has_luggage: hasLuggage,
        cargo_description: transportType === "CARGO" ? cargoDescription : undefined,
      });
      setPickup(""); setDropoff(""); setPickupPoint(null); setDropoffPoint(null); setHasLuggage(false); setCargoDescription("");
      load();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : t("oazigo.requestFailed"));
    } finally {
      setRequesting(false);
    }
  }

  async function handleRegisterDriver() {
    await registerAsDriver(licenseNumber);
    setShowDriverForm(false);
    setLicenseNumber("");
    load();
  }

  async function handleRegisterVehicle() {
    await registerVehicle({ vehicle_category: vehicleCategory, make: vehicleMake, model: vehicleModel, plate_number: plateNumber });
    setShowVehicleForm(false);
    setVehicleMake(""); setVehicleModel(""); setPlateNumber("");
    load();
  }

  async function handleAccept(rideId: string) {
    if (!selectedVehicleId) return;
    await acceptRide(rideId, selectedVehicleId);
    setAcceptingRideId(null);
    setSelectedVehicleId(null);
    load();
  }

  async function handleStart(id: string) {
    try {
      await startRide(id);
      load();
    } catch (err) {
      Alert.alert(t("common.actionFailedTitle"), err instanceof Error ? err.message : t("common.actionFailedBody"));
    }
  }

  function handleSos(id: string) {
    Alert.alert(
      t("oazigo.sosConfirmTitle"),
      t("oazigo.sosConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("oazigo.sosSend"),
          style: "destructive",
          onPress: async () => {
            try {
              const result = await raiseRideSos(id, await getCurrentCoords());
              const contact = result.emergency_contact;
              const contactSent = contact?.status === "sent";
              const alerted = result.admins_alerted > 0 || contactSent;
              Alert.alert(
                alerted ? t("oazigo.sosSentTitle") : t("oazigo.sosRecordedTitle"),
                !alerted
                  ? t("oazigo.sosNoOperator")
                  : contactSent
                    ? t("oazigo.sosSentWithContact")
                    : contact
                      ? t("oazigo.sosContactNotTexted", { name: contact.name })
                      : t("oazigo.sosSentBody"),
              );
              load();
            } catch (err) {
              Alert.alert(t("oazigo.sosFailedTitle"), err instanceof Error ? err.message : t("oazigo.sosFailedBody"));
            }
          },
        },
      ],
    );
  }

  async function runReasonAction(action: () => Promise<unknown>) {
    try {
      await action();
      setAsking(null);
      load();
    } catch (err) {
      Alert.alert(t("common.actionFailedTitle"), err instanceof Error ? err.message : t("common.actionFailedBody"));
    }
  }

  async function handleComplete(id: string) {
    if (!phoneNumber) return;
    try {
      const ride = await completeRide(id, phoneNumber);
      if (ride.status !== "COMPLETED") setAwaitingRideId(id);
    } catch (err) {
      Alert.alert(t("common.actionFailedTitle"), err instanceof Error ? err.message : t("common.actionFailedBody"));
    }
    setPayingId(null);
    setPhoneNumber("");
    load();
  }

  // A real fare is confirmed by the provider once the rider approves it on their phone: watch until it is.
  const waitingForFare = awaitingRideId !== null && rides.some((r) => r.id === awaitingRideId && r.status === "IN_PROGRESS");
  usePollWhile(waitingForFare, load, () => {
    setAwaitingRideId(null);
    Alert.alert(t("oazigo.paymentTimedOutTitle"), t("oazigo.paymentTimedOutBody"));
  });

  const canDrive = driverProfile?.is_verified && vehicles.length > 0;
  const earnings = driverEarnings(rides, myUserId);
  const onTrip = rides.some((r) => r.driver === myUserId && (r.status === "ACCEPTED" || r.status === "IN_PROGRESS"));
  const online = Boolean(driverProfile?.is_verified && driverProfile.is_online);
  useDriverLocationSharing(Boolean(driverProfile?.is_verified && (driverProfile.is_online || onTrip)));

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <>
    <RideOfferModal active={online && vehicles.length > 0} vehicles={vehicles} onAccepted={load} />
    <FlatList
      data={rides}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>{t("oazigo.noRides")}</Text>}
      ListHeaderComponent={
        <View>
          <LanguageToggle />
          <EmergencyContactCard />
          <View style={styles.formCard}>
            <RidePlaceField placeholder={t("oazigo.pickupPlaceholder")} text={pickup} onTextChange={setPickup} point={pickupPoint} onPointChange={setPickupPoint} allowCurrentLocation />
            <RidePlaceField placeholder={t("oazigo.dropoffPlaceholder")} text={dropoff} onTextChange={setDropoff} point={dropoffPoint} onPointChange={setDropoffPoint} />
            {!points ? <Text style={styles.routeHint}>{t("oazigo.chooseBothPoints")}</Text> : null}
            {quoting ? <Text style={styles.routeHint}>{t("oazigo.quoteLoading")}</Text> : null}
            {quote ? (
              <Text style={styles.routeSummary}>
                {t(quote.source === "google" ? "oazigo.routeSummary" : "oazigo.routeSummaryEstimated", {
                  km: Number(quote.distance_km).toLocaleString(locale, { maximumFractionDigits: 1 }), minutes: quote.duration_minutes,
                })}
              </Text>
            ) : null}
            {quoteFailed ? (
              <TouchableOpacity onPress={() => setQuoteAttempt((n) => n + 1)}>
                <Text style={styles.errorText}>{t("oazigo.quoteFailed")} {t("oazigo.quoteRetry")} ↻</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.label}>{t("oazigo.vehicleType")}</Text>
            <View style={styles.chipRow}>
              {RIDE_CATEGORIES.map((cat) => (
                <TouchableOpacity key={cat} style={[styles.chip, rideCategory === cat && styles.chipActive]} onPress={() => setRideCategory(cat)}>
                  <Text style={[styles.chipText, rideCategory === cat && styles.chipTextActive]}>{categoryLabel(cat)}</Text>
                  {quote ? <Text style={[styles.chipFare, rideCategory === cat && styles.chipTextActive]}>{Number(quote.fares[cat]).toLocaleString(locale)} XAF</Text> : null}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.toggleRow}>
              {(["PASSENGER", "CARGO"] as const).map((type) => (
                <TouchableOpacity key={type} style={[styles.toggle, transportType === type && styles.toggleActive]} onPress={() => setTransportType(type)}>
                  <Text style={[styles.toggleText, transportType === type && styles.toggleTextActive]}>{type === "PASSENGER" ? t("oazigo.passenger") : t("oazigo.cargo")}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {transportType === "CARGO" ? (
              <TextInput style={styles.input} placeholder={t("oazigo.cargoPlaceholder")} value={cargoDescription} onChangeText={setCargoDescription} />
            ) : (
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t("oazigo.hasLuggage")}</Text>
                <Switch value={hasLuggage} onValueChange={setHasLuggage} />
              </View>
            )}

            {quote ? (
              <View style={styles.fareBox}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fareBoxTitle}>{t("oazigo.fareTitle")}</Text>
                  <Text style={styles.fareBoxNote}>{t(quote.source === "google" ? "oazigo.fareNote" : "oazigo.fareNoteApprox")}</Text>
                </View>
                <Text style={styles.fareBoxValue}>{Number(quote.fares[rideCategory]).toLocaleString(locale)} XAF</Text>
              </View>
            ) : null}
            {requestError ? <Text style={styles.errorText}>{requestError}</Text> : null}
            <TouchableOpacity style={[styles.requestButton, !quote ? { opacity: 0.5 } : null]} onPress={handleRequest} disabled={requesting || !quote}>
              {requesting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.requestButtonText}>{t("oazigo.requestRide")}</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.driverCard}>
            <Text style={styles.driverCardTitle}>{t("oazigo.driveTitle")}</Text>
            {!driverProfile ? (
              showDriverForm ? (
                <View style={styles.inlineRow}>
                  <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder={t("oazigo.licensePlaceholder")} value={licenseNumber} onChangeText={setLicenseNumber} />
                  <TouchableOpacity style={styles.smallButton} onPress={handleRegisterDriver}><Text style={styles.smallButtonText}>{t("oazigo.register")}</Text></TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowDriverForm(true)}><Text style={styles.secondaryButtonText}>{t("oazigo.registerAsDriver")}</Text></TouchableOpacity>
              )
            ) : !driverProfile.is_verified ? (
              <Text style={styles.pendingText}>{t("oazigo.pendingVerification")}</Text>
            ) : (
              <View>
                <Text style={styles.verifiedText}>{t("oazigo.verifiedDriver")}</Text>
                <DriverOnlineCard
                  driverProfile={driverProfile}
                  hasVehicle={vehicles.length > 0}
                  onChanged={(profile) => setDriverProfile((current) => (current ? { ...current, ...profile } : profile))}
                />
                <View style={styles.earningsRow}>
                  <View style={styles.earningsBox}>
                    <Text style={styles.earningsLabel}>{t("oazigo.earningsCompleted")}</Text>
                    <Text style={styles.earningsValue}>{earnings.completedTrips}</Text>
                    <Text style={styles.earningsHint}>{t("oazigo.earningsInProgress", { count: earnings.activeTrips })}</Text>
                  </View>
                  <View style={styles.earningsBox}>
                    <Text style={styles.earningsLabel}>{t("oazigo.earningsGross")}</Text>
                    <Text style={styles.earningsValue}>{earnings.grossXaf.toLocaleString(locale)} XAF</Text>
                    <Text style={styles.earningsHint}>{t("oazigo.earningsGrossHint")}</Text>
                  </View>
                </View>
                <WalletPayoutCard />
                {vehicles.map((v) => (
                  <Text key={v.id} style={styles.vehicleLine}>🚗 {v.make} {v.model} — {categoryLabel(v.vehicle_category)} ({v.plate_number})</Text>
                ))}
                {showVehicleForm ? (
                  <ScrollView>
                    <View style={styles.chipRow}>
                      {RIDE_CATEGORIES.map((cat) => (
                        <TouchableOpacity key={cat} style={[styles.chip, vehicleCategory === cat && styles.chipActive]} onPress={() => setVehicleCategory(cat)}>
                          <Text style={[styles.chipText, vehicleCategory === cat && styles.chipTextActive]}>{categoryLabel(cat)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput style={styles.input} placeholder={t("oazigo.makePlaceholder")} value={vehicleMake} onChangeText={setVehicleMake} />
                    <TextInput style={styles.input} placeholder={t("oazigo.modelPlaceholder")} value={vehicleModel} onChangeText={setVehicleModel} />
                    <TextInput style={styles.input} placeholder={t("oazigo.platePlaceholder")} value={plateNumber} onChangeText={setPlateNumber} />
                    <TouchableOpacity style={styles.smallButton} onPress={handleRegisterVehicle}><Text style={styles.smallButtonText}>{t("oazigo.registerVehicle")}</Text></TouchableOpacity>
                  </ScrollView>
                ) : (
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowVehicleForm(true)}><Text style={styles.secondaryButtonText}>{t("oazigo.addVehicle")}</Text></TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.route}>{item.pickup_description} → {item.dropoff_description}</Text>
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] || "#9CA3AF" }]}>
              <Text style={styles.statusBadgeText}>{item.status.replace("_", " ")}</Text>
            </View>
          </View>
          <View style={styles.badgeRow}>
            <Text style={styles.metaBadge}>{categoryLabel(item.ride_category)}</Text>
            {item.transport_type === "CARGO" && <Text style={styles.cargoBadge}>{t("oazigo.cargoBadge")}</Text>}
            {item.has_luggage && <Text style={styles.metaBadge}>{t("oazigo.luggageBadge")}</Text>}
          </View>
          {item.cargo_description ? <Text style={styles.cargoDesc}>{item.cargo_description}</Text> : null}
          <Text style={styles.fare}>{Number(item.fare_estimate_xaf).toLocaleString(locale)} XAF</Text>
          {item.driver_name && item.status !== "CANCELLED" && (
            <Text style={styles.cargoDesc}>
              {t("oazigo.driverLine", { name: item.driver_name })}
              {item.vehicle_details ? ` · ${item.vehicle_details.make} ${item.vehicle_details.model} · ${item.vehicle_details.plate_number}` : ""}
            </Text>
          )}
          {item.status === "CANCELLED" && item.cancellation_reason ? (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonText}>
                {item.cancellation_reason === "NO_DRIVER_FOUND"
                  ? t("oazigo.autoCancelled")
                  : t(item.rider === myUserId ? "oazigo.youCancelled" : "oazigo.riderCancelled", { reason: t(`cancelReason.${item.cancellation_reason}`) })}
              </Text>
              {item.cancellation_note ? <Text style={styles.reasonNote}>“{item.cancellation_note}”</Text> : null}
            </View>
          ) : null}
          {item.status === "REQUESTED" && item.rider === myUserId && item.release_reason ? (
            <View style={[styles.reasonBox, styles.reasonBoxWarn]}>
              <Text style={styles.reasonText}>
                {t("oazigo.previousDriverPulledOut", { reason: t(`releaseReason.${item.release_reason}`) })}
              </Text>
              {item.release_note ? <Text style={styles.reasonNote}>“{item.release_note}”</Text> : null}
            </View>
          ) : null}
          {item.status === "COMPLETED" && myUserId && (() => {
            const otherId = item.rider === myUserId ? item.driver : item.rider;
            return otherId ? (
              <View style={styles.rateBlock}>
                <Text style={styles.cargoDesc}>{t("oazigo.rateTrip")}</Text>
                <RateAndReport subjectUserId={otherId} />
              </View>
            ) : null;
          })()}
          {item.status === "REQUESTED" && canDrive && acceptingRideId !== item.id && (
            <TouchableOpacity onPress={() => setAcceptingRideId(item.id)}><Text style={styles.actionLink}>{t("oazigo.acceptAsDriver")}</Text></TouchableOpacity>
          )}
          {acceptingRideId === item.id && (
            <View style={styles.acceptRow}>
              {vehicles.map((v) => (
                <TouchableOpacity key={v.id} style={[styles.chip, selectedVehicleId === v.id && styles.chipActive]} onPress={() => setSelectedVehicleId(v.id)}>
                  <Text style={[styles.chipText, selectedVehicleId === v.id && styles.chipTextActive]}>{v.make} {v.model}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.smallButton} onPress={() => handleAccept(item.id)}><Text style={styles.smallButtonText}>{t("oazigo.confirm")}</Text></TouchableOpacity>
            </View>
          )}
          {item.status === "ACCEPTED" && myUserId && item.driver === myUserId && (
            <TouchableOpacity onPress={() => handleStart(item.id)}><Text style={styles.actionLink}>{t("oazigo.startRide")}</Text></TouchableOpacity>
          )}
          {item.status === "ACCEPTED" && myUserId && item.driver === myUserId && asking?.id !== item.id && (
            <TouchableOpacity onPress={() => setAsking({ id: item.id, kind: "release" })}>
              <Text style={styles.secondaryLink}>{t("oazigo.releaseRide")}</Text>
            </TouchableOpacity>
          )}
          {(item.status === "REQUESTED" || item.status === "ACCEPTED") && myUserId && item.rider === myUserId && asking?.id !== item.id && (
            <TouchableOpacity onPress={() => setAsking({ id: item.id, kind: "cancel" })}>
              <Text style={styles.dangerLink}>{t("oazigo.cancelRide")}</Text>
            </TouchableOpacity>
          )}
          {asking?.id === item.id && asking.kind === "cancel" && (
            <RideReasonPicker
              title={t("oazigo.cancelWhy")} reasons={RIDE_CANCEL_REASONS} labelPrefix="cancelReason" confirmLabel={t("oazigo.cancelRide")}
              onConfirm={(reason: RideCancelReason, note) => runReasonAction(() => cancelRide(item.id, { reason, note }))}
              onBack={() => setAsking(null)}
            />
          )}
          {asking?.id === item.id && asking.kind === "release" && (
            <RideReasonPicker
              title={t("oazigo.releaseWhy")} reasons={RIDE_RELEASE_REASONS} labelPrefix="releaseReason" confirmLabel={t("oazigo.releaseRide")}
              onConfirm={(reason: RideReleaseReason, note) => runReasonAction(() => releaseRide(item.id, { reason, note }))}
              onBack={() => setAsking(null)}
            />
          )}
          {(item.status === "ACCEPTED" || item.status === "IN_PROGRESS") && myUserId && (item.rider === myUserId || item.driver === myUserId) && (
            <TouchableOpacity style={styles.sosButton} onPress={() => handleSos(item.id)}>
              <Text style={styles.sosButtonText}>{t("oazigo.sosButton")}</Text>
            </TouchableOpacity>
          )}
          {item.status === "IN_PROGRESS" && payingId !== item.id && awaitingRideId !== item.id && (
            <TouchableOpacity onPress={() => setPayingId(item.id)}><Text style={styles.actionLink}>{t("oazigo.completeAndPay")}</Text></TouchableOpacity>
          )}
          {item.status === "IN_PROGRESS" && awaitingRideId === item.id && (
            <Text style={styles.routeHint}>{t("oazigo.approveFareOnPhone")}</Text>
          )}
          {item.status === "CANCELLED" && awaitingRideId === item.id && (
            <Text style={styles.routeHint}>{t("oazigo.paymentRefunded")}</Text>
          )}
          {payingId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder={t("oazigo.phonePlaceholder")} value={phoneNumber} onChangeText={setPhoneNumber} />
              <TouchableOpacity style={styles.payButton} onPress={() => handleComplete(item.id)}><Text style={styles.payButtonText}>{t("oazigo.pay")}</Text></TouchableOpacity>
            </View>
          )}
          {canReportRideIssue(item, myUserId) && <RideIssueReport rideId={item.id} isDriver={item.driver === myUserId} />}
        </View>
      )}
    />
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  formCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14 },
  label: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  chipActive: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipText: { fontSize: 11, color: "#374151" },
  chipFare: { fontSize: 10, fontWeight: "700", color: "#6B7280", marginTop: 1 },
  routeHint: { fontSize: 12, color: "#6B7280", marginBottom: 8 },
  routeSummary: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginBottom: 8 },
  fareBox: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#A7F3D0", backgroundColor: "#ECFDF5", borderRadius: 12, padding: 12, marginBottom: 10 },
  fareBoxTitle: { fontSize: 11, fontWeight: "800", color: "#065F46", textTransform: "uppercase" },
  fareBoxNote: { fontSize: 11, color: "#047857", marginTop: 2 },
  fareBoxValue: { fontSize: 20, fontWeight: "900", color: "#064E3B" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  toggleRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  toggle: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  toggleActive: { backgroundColor: "#C9A227", borderColor: "#C9A227" },
  toggleText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  toggleTextActive: { color: "#1B2A4A" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  switchLabel: { fontSize: 13, color: "#374151" },
  errorText: { color: "#DC2626", fontSize: 12, marginBottom: 8 },
  requestButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  requestButtonText: { color: "#1B2A4A", fontWeight: "700" },
  driverCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, marginBottom: 16 },
  driverCardTitle: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginBottom: 10 },
  inlineRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  secondaryButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  secondaryButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  pendingText: { fontSize: 13, color: "#6B7280" },
  verifiedText: { fontSize: 13, color: "#16A34A", fontWeight: "700", marginBottom: 8 },
  vehicleLine: { fontSize: 13, color: "#374151", marginBottom: 4 },
  earningsRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  earningsBox: { flex: 1, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 10, backgroundColor: "#F9FAFB" },
  earningsLabel: { fontSize: 11, fontWeight: "700", color: "#6B7280", textTransform: "uppercase" },
  earningsValue: { fontSize: 16, fontWeight: "800", color: "#1B2A4A", marginTop: 2 },
  earningsHint: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  reasonBox: { borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB", borderRadius: 8, padding: 8, marginBottom: 8 },
  reasonBoxWarn: { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
  reasonText: { fontSize: 12, fontWeight: "700", color: "#374151" },
  reasonNote: { fontSize: 12, fontStyle: "italic", color: "#6B7280", marginTop: 2 },
  rateBlock: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  smallButton: { backgroundColor: "#1B2A4A", borderRadius: 6, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  smallButtonText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  route: { flex: 1, fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginRight: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 6, flexWrap: "wrap" },
  metaBadge: { fontSize: 10, color: "#374151", backgroundColor: "#F3F4F6", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  cargoBadge: { fontSize: 10, color: "#1B2A4A", backgroundColor: "#C9A227", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, fontWeight: "700" },
  cargoDesc: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  fare: { fontSize: 14, color: "#374151", marginBottom: 8 },
  actionLink: { fontSize: 13, color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline" },
  secondaryLink: { fontSize: 13, color: "#4B5563", fontWeight: "600", textDecorationLine: "underline", marginTop: 6 },
  dangerLink: { fontSize: 13, color: "#B91C1C", fontWeight: "600", textDecorationLine: "underline", marginTop: 6 },
  sosButton: { backgroundColor: "#B91C1C", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 10 },
  sosButtonText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  acceptRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" },
  payRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  payInput: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 6, padding: 8, fontSize: 13 },
  payButton: { backgroundColor: "#C9A227", borderRadius: 6, paddingHorizontal: 16, justifyContent: "center" },
  payButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
});

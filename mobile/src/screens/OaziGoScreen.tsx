import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Switch, ScrollView } from "react-native";
import {
  listMyRides, requestRide, acceptRide, startRide, completeRide,
  getMyDriverProfile, registerAsDriver, listMyVehicles, registerVehicle,
  type RideBookingItem, type DriverProfileItem, type VehicleItem,
} from "../lib/api";

const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#C9A227", ACCEPTED: "#1B2A4A", IN_PROGRESS: "#1B2A4A", COMPLETED: "#16A34A", CANCELLED: "#A8502E",
};
const RIDE_CATEGORIES = ["MOTO", "STANDARD", "COMFORT", "VAN", "TRUCK"];
const CATEGORY_LABELS: Record<string, string> = { MOTO: "Moto", STANDARD: "Standard", COMFORT: "Comfort", VAN: "Van", TRUCK: "Truck" };

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
  const [rides, setRides] = useState<RideBookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [driverProfile, setDriverProfile] = useState<DriverProfileItem | null>(null);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [distance, setDistance] = useState("");
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
  const [phoneNumber, setPhoneNumber] = useState("");

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

  async function handleRequest() {
    setRequesting(true);
    setRequestError("");
    try {
      await requestRide({
        pickup_description: pickup, dropoff_description: dropoff, distance_km: distance,
        ride_category: rideCategory, transport_type: transportType, has_luggage: hasLuggage,
        cargo_description: transportType === "CARGO" ? cargoDescription : undefined,
      });
      setPickup(""); setDropoff(""); setDistance(""); setHasLuggage(false); setCargoDescription("");
      load();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Could not request a ride.");
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

  async function handleStart(id: string) { await startRide(id); load(); }
  async function handleComplete(id: string) {
    if (!phoneNumber) return;
    await completeRide(id, phoneNumber);
    setPayingId(null);
    setPhoneNumber("");
    load();
  }

  const canDrive = driverProfile?.is_verified && vehicles.length > 0;

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={rides}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No rides yet.</Text>}
      ListHeaderComponent={
        <View>
          <View style={styles.formCard}>
            <TextInput style={styles.input} placeholder="Pickup location" value={pickup} onChangeText={setPickup} />
            <TextInput style={styles.input} placeholder="Drop-off location" value={dropoff} onChangeText={setDropoff} />
            <TextInput style={styles.input} placeholder="Distance (km)" value={distance} onChangeText={setDistance} keyboardType="numeric" />

            <Text style={styles.label}>Vehicle Type</Text>
            <View style={styles.chipRow}>
              {RIDE_CATEGORIES.map((cat) => (
                <TouchableOpacity key={cat} style={[styles.chip, rideCategory === cat && styles.chipActive]} onPress={() => setRideCategory(cat)}>
                  <Text style={[styles.chipText, rideCategory === cat && styles.chipTextActive]}>{CATEGORY_LABELS[cat]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.toggleRow}>
              {(["PASSENGER", "CARGO"] as const).map((type) => (
                <TouchableOpacity key={type} style={[styles.toggle, transportType === type && styles.toggleActive]} onPress={() => setTransportType(type)}>
                  <Text style={[styles.toggleText, transportType === type && styles.toggleTextActive]}>{type === "PASSENGER" ? "Passenger" : "Cargo / Materials"}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {transportType === "CARGO" ? (
              <TextInput style={styles.input} placeholder="What's being moved? (e.g. cement, furniture)" value={cargoDescription} onChangeText={setCargoDescription} />
            ) : (
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>I have luggage</Text>
                <Switch value={hasLuggage} onValueChange={setHasLuggage} />
              </View>
            )}

            {requestError ? <Text style={styles.errorText}>{requestError}</Text> : null}
            <TouchableOpacity style={styles.requestButton} onPress={handleRequest} disabled={requesting}>
              {requesting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.requestButtonText}>Request OaziGo</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.driverCard}>
            <Text style={styles.driverCardTitle}>Want to Drive with OaziGo?</Text>
            {!driverProfile ? (
              showDriverForm ? (
                <View style={styles.inlineRow}>
                  <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="Driver's license number" value={licenseNumber} onChangeText={setLicenseNumber} />
                  <TouchableOpacity style={styles.smallButton} onPress={handleRegisterDriver}><Text style={styles.smallButtonText}>Register</Text></TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowDriverForm(true)}><Text style={styles.secondaryButtonText}>Register as a Driver</Text></TouchableOpacity>
              )
            ) : !driverProfile.is_verified ? (
              <Text style={styles.pendingText}>Your driver registration is awaiting verification.</Text>
            ) : (
              <View>
                <Text style={styles.verifiedText}>✓ You&apos;re a verified OaziGo driver.</Text>
                {vehicles.map((v) => (
                  <Text key={v.id} style={styles.vehicleLine}>🚗 {v.make} {v.model} — {CATEGORY_LABELS[v.vehicle_category]} ({v.plate_number})</Text>
                ))}
                {showVehicleForm ? (
                  <ScrollView>
                    <View style={styles.chipRow}>
                      {RIDE_CATEGORIES.map((cat) => (
                        <TouchableOpacity key={cat} style={[styles.chip, vehicleCategory === cat && styles.chipActive]} onPress={() => setVehicleCategory(cat)}>
                          <Text style={[styles.chipText, vehicleCategory === cat && styles.chipTextActive]}>{CATEGORY_LABELS[cat]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput style={styles.input} placeholder="Make (e.g. Toyota)" value={vehicleMake} onChangeText={setVehicleMake} />
                    <TextInput style={styles.input} placeholder="Model (e.g. Corolla)" value={vehicleModel} onChangeText={setVehicleModel} />
                    <TextInput style={styles.input} placeholder="Plate number" value={plateNumber} onChangeText={setPlateNumber} />
                    <TouchableOpacity style={styles.smallButton} onPress={handleRegisterVehicle}><Text style={styles.smallButtonText}>Register Vehicle</Text></TouchableOpacity>
                  </ScrollView>
                ) : (
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowVehicleForm(true)}><Text style={styles.secondaryButtonText}>Add a Vehicle</Text></TouchableOpacity>
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
            <Text style={styles.metaBadge}>{CATEGORY_LABELS[item.ride_category]}</Text>
            {item.transport_type === "CARGO" && <Text style={styles.cargoBadge}>Cargo</Text>}
            {item.has_luggage && <Text style={styles.metaBadge}>🧳 Luggage</Text>}
          </View>
          {item.cargo_description ? <Text style={styles.cargoDesc}>{item.cargo_description}</Text> : null}
          <Text style={styles.fare}>{Number(item.fare_estimate_xaf).toLocaleString()} XAF</Text>

          {item.status === "REQUESTED" && canDrive && acceptingRideId !== item.id && (
            <TouchableOpacity onPress={() => setAcceptingRideId(item.id)}><Text style={styles.actionLink}>Accept as Driver</Text></TouchableOpacity>
          )}
          {acceptingRideId === item.id && (
            <View style={styles.acceptRow}>
              {vehicles.map((v) => (
                <TouchableOpacity key={v.id} style={[styles.chip, selectedVehicleId === v.id && styles.chipActive]} onPress={() => setSelectedVehicleId(v.id)}>
                  <Text style={[styles.chipText, selectedVehicleId === v.id && styles.chipTextActive]}>{v.make} {v.model}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.smallButton} onPress={() => handleAccept(item.id)}><Text style={styles.smallButtonText}>Confirm</Text></TouchableOpacity>
            </View>
          )}
          {item.status === "ACCEPTED" && (
            <TouchableOpacity onPress={() => handleStart(item.id)}><Text style={styles.actionLink}>Start Ride</Text></TouchableOpacity>
          )}
          {item.status === "IN_PROGRESS" && payingId !== item.id && (
            <TouchableOpacity onPress={() => setPayingId(item.id)}><Text style={styles.actionLink}>Complete & Pay</Text></TouchableOpacity>
          )}
          {payingId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} />
              <TouchableOpacity style={styles.payButton} onPress={() => handleComplete(item.id)}><Text style={styles.payButtonText}>Pay</Text></TouchableOpacity>
            </View>
          )}
        </View>
      )}
    />
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
  acceptRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" },
  payRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  payInput: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 6, padding: 8, fontSize: 13 },
  payButton: { backgroundColor: "#C9A227", borderRadius: 6, paddingHorizontal: 16, justifyContent: "center" },
  payButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
});

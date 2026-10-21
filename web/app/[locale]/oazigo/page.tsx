"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  listMyRides, requestRide, acceptRide, startRide, completeRide, cancelRide, releaseRide, raiseRideSos,
  getMyDriverProfile, registerAsDriver, listMyVehicles, registerVehicle, getMyProfile,
  type RideBookingItem, type DriverProfileItem, type VehicleItem,
} from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import GpsCaptureButton from "@/components/GpsCaptureButton";
import RideChat from "@/components/RideChat";
import RateAndReport from "@/components/RateAndReport";
import EmergencyContactCard from "@/components/EmergencyContactCard";
import { IconMapPin, IconCompass } from "@/components/Icons";

const STATUS_VARIANT: Record<string, "navy" | "gold" | "green" | "clay"> = {
  REQUESTED: "gold", ACCEPTED: "navy", IN_PROGRESS: "navy", COMPLETED: "green", CANCELLED: "clay",
};
const RIDE_CATEGORIES = ["MOTO", "STANDARD", "COMFORT", "VAN", "TRUCK"] as const;

/**
 * OaziGo — Oaziland's own-branded ride and transport service, per
 * the founder's explicit naming. A dedicated top-level page, the
 * same real brand treatment already given to Taskln Service, not
 * buried under a generic /marketplace/rides route.
 *
 * Real gaps closed in this pass: luggage, real vehicle categories
 * (Moto/Standard/Comfort/Van/Truck — the same real tiered choice
 * Yango already offers, each with its own real fare), and real
 * cargo/building-materials transport for the platform's own real
 * estate use case — moving materials or furniture between
 * properties, not just passengers. Most importantly: real driver and
 * vehicle registration — previously any signed-in user could accept
 * a ride with zero vetting; now requires a real, admin-verified
 * DriverProfile and a registered Vehicle whose category genuinely
 * matches the ride.
 */
export default function OaziGoPage() {
  const t = useTranslations("OaziGoPage");
  const [rides, setRides] = useState<RideBookingItem[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [driverProfile, setDriverProfile] = useState<DriverProfileItem | null>(null);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [activeChatRideId, setActiveChatRideId] = useState<string | null>(null);

  // Request form
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [distance, setDistance] = useState("");
  const [pickupGps, setPickupGps] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });
  const [dropoffGps, setDropoffGps] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });
  const [rideCategory, setRideCategory] = useState<string>("STANDARD");
  const [transportType, setTransportType] = useState<"PASSENGER" | "CARGO">("PASSENGER");
  const [hasLuggage, setHasLuggage] = useState(false);
  const [cargoDescription, setCargoDescription] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");

  // Driver/vehicle registration
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [vehicleCategory, setVehicleCategory] = useState<string>("STANDARD");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [plateNumber, setPlateNumber] = useState("");

  // Accepting a ride
  const [acceptingRideId, setAcceptingRideId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [rideActionError, setRideActionError] = useState("");
  const [sosMessage, setSosMessage] = useState<{ rideId: string; text: string } | null>(null);
  const [payingRideId, setPayingRideId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  const fetchAll = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return null;
    return Promise.all([
      listMyRides(token),
      getMyDriverProfile(token).catch(() => null),
      listMyVehicles(token).catch(() => ({ results: [] })),
      getMyProfile(token).catch(() => null),
    ]).catch(() => undefined);
  }, []);

  const apply = useCallback((data: Awaited<NonNullable<ReturnType<typeof fetchAll>>> | null) => {
    if (data === null) {
      setStatus("signedOut");
      return;
    }
    if (data) {
      const [ridesData, driverData, vehiclesData, profileData] = data;
      setRides(ridesData.results);
      setDriverProfile(driverData);
      setVehicles(vehiclesData.results);
      if (profileData) setMyUserId(profileData.id);
    }
    setStatus("ready");
  }, []);

  const load = useCallback(() => {
    const pending = fetchAll();
    if (pending) pending.then(apply);
    else apply(null);
  }, [fetchAll, apply]);

  useEffect(() => {
    const pending = fetchAll();
    if (pending) pending.then(apply);
    else Promise.resolve().then(() => apply(null));
  }, [fetchAll, apply]);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRequesting(true);
    setRequestError("");
    try {
      await requestRide({
        pickup_description: pickup,
        dropoff_description: dropoff,
        distance_km: distance,
        pickup_latitude: pickupGps.latitude,
        pickup_longitude: pickupGps.longitude,
        dropoff_latitude: dropoffGps.latitude,
        dropoff_longitude: dropoffGps.longitude,
        ride_category: rideCategory,
        transport_type: transportType,
        has_luggage: hasLuggage,
        cargo_description: transportType === "CARGO" ? cargoDescription : undefined,
      }, token);
      setPickup("");
      setDropoff("");
      setDistance("");
      setHasLuggage(false);
      setCargoDescription("");
      setPickupGps({ latitude: null, longitude: null });
      setDropoffGps({ latitude: null, longitude: null });
      load();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : t("requestFailed"));
    } finally {
      setRequesting(false);
    }
  }

  async function handleRegisterDriver(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await registerAsDriver(licenseNumber, token);
    setShowDriverForm(false);
    setLicenseNumber("");
    load();
  }

  async function handleRegisterVehicle(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await registerVehicle({ vehicle_category: vehicleCategory, make: vehicleMake, model: vehicleModel, plate_number: plateNumber }, token);
    setShowVehicleForm(false);
    setVehicleMake(""); setVehicleModel(""); setPlateNumber("");
    load();
  }

  async function handleAccept(rideId: string) {
    const token = localStorage.getItem("access_token");
    if (!token || !selectedVehicleId) return;
    await acceptRide(rideId, selectedVehicleId, token);
    setAcceptingRideId(null);
    setSelectedVehicleId(null);
    load();
  }

  async function handleStart(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await startRide(id, token);
    load();
  }

  async function runRideAction(action: (token: string) => Promise<unknown>) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRideActionError("");
    try {
      await action(token);
      load();
    } catch (err) {
      setRideActionError(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  function handleCancel(id: string) {
    if (!window.confirm(t("confirmCancelRide"))) return;
    runRideAction((token) => cancelRide(id, token));
  }

  async function handleSos(id: string) {
    if (!window.confirm(t("sosConfirm"))) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRideActionError("");
    // Send the location when the browser can share it quickly; the alert goes out either way.
    const coords = await new Promise<{ latitude: number; longitude: number } | undefined>((resolve) => {
      if (!navigator.geolocation) return resolve(undefined);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(undefined),
        { timeout: 4000, maximumAge: 60000 },
      );
    });
    try {
      const result = await raiseRideSos(id, token, coords);
      const text = result.admins_alerted > 0 || result.emergency_contact_alerted
        ? t(result.emergency_contact_alerted ? "sosSentWithContact" : "sosSent")
        : t("sosNoOperator");
      setSosMessage({ rideId: id, text });
      load();
    } catch (err) {
      setRideActionError(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  async function handleComplete(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token || !phoneNumber) return;
    await completeRide(id, phoneNumber, token);
    setPayingRideId(null);
    setPhoneNumber("");
    load();
  }

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Button href="/login">{t("signInRequired")}</Button>
      </main>
    );
  }

  const canDrive = driverProfile?.is_verified && vehicles.length > 0;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <EmergencyContactCard />

      {/* Real ride request form */}
      <form onSubmit={handleRequest} className="border border-gray-200 rounded-xl p-6 bg-white mb-6 flex flex-col gap-3">
        <div>
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
            Pickup Location
          </label>
          <input required placeholder={t("pickupPlaceholder")} value={pickup} onChange={(e) => setPickup(e.target.value)} className="border rounded-lg px-3 py-2 w-full" />
          <div className="mt-1.5">
            <GpsCaptureButton
              onCapture={(coords) => setPickupGps(coords)}
              currentCoords={pickupGps}
              label="Capture My Current Pickup GPS"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
            Destination / Dropoff
          </label>
          <input required placeholder={t("dropoffPlaceholder")} value={dropoff} onChange={(e) => setDropoff(e.target.value)} className="border rounded-lg px-3 py-2 w-full" />
          <div className="mt-1.5">
            <GpsCaptureButton
              onCapture={(coords) => setDropoffGps(coords)}
              currentCoords={dropoffGps}
              label="Capture Dropoff Location GPS (Optional)"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
            Estimated Distance (km)
          </label>
          <input required type="number" step="0.1" placeholder={t("distancePlaceholder")} value={distance} onChange={(e) => setDistance(e.target.value)} className="border rounded-lg px-3 py-2 w-full" />
        </div>

        <p className="text-sm font-semibold text-[var(--navy)] mt-1">{t("vehicleCategoryLabel")}</p>
        <div className="flex flex-wrap gap-2">
          {RIDE_CATEGORIES.map((cat) => (
            <button
              type="button" key={cat} onClick={() => setRideCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${rideCategory === cat ? "bg-[var(--navy)] text-white border-[var(--navy)]" : "border-gray-300 text-gray-700"}`}
            >
              {t(`category_${cat}`)}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mt-1">
          {(["PASSENGER", "CARGO"] as const).map((type) => (
            <button
              type="button" key={type} onClick={() => setTransportType(type)}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${transportType === type ? "bg-[var(--gold)] text-[var(--navy)] border-[var(--gold)]" : "border-gray-300 text-gray-700"}`}
            >
              {type === "PASSENGER" ? t("transportPassenger") : t("transportCargo")}
            </button>
          ))}
        </div>

        {transportType === "CARGO" ? (
          <input required placeholder={t("cargoDescriptionPlaceholder")} value={cargoDescription} onChange={(e) => setCargoDescription(e.target.value)} className="border rounded-lg px-3 py-2" />
        ) : (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={hasLuggage} onChange={(e) => setHasLuggage(e.target.checked)} />
            {t("hasLuggageLabel")}
          </label>
        )}

        {requestError && <p className="text-red-600 text-sm">{requestError}</p>}
        <Button size="lg" disabled={requesting}>{requesting ? t("requesting") : t("requestRide")}</Button>
      </form>

      {/* Real driver/vehicle registration */}
      <div className="border border-gray-200 rounded-xl p-6 bg-white mb-8">
        <h2 className="text-sm font-semibold text-[var(--navy)] mb-3">{t("wantToDriveTitle")}</h2>

        {!driverProfile ? (
          showDriverForm ? (
            <form onSubmit={handleRegisterDriver} className="flex gap-2">
              <input required placeholder={t("licenseNumberPlaceholder")} value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} className="border rounded-lg px-3 py-2 flex-1" />
              <Button>{t("register")}</Button>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setShowDriverForm(true)}>{t("registerAsDriver")}</Button>
          )
        ) : !driverProfile.is_verified ? (
          <p className="text-sm text-gray-500">{t("driverPendingVerification")}</p>
        ) : (
          <div>
            <p className="text-sm text-green-700 mb-3">✓ {t("verifiedDriver")}</p>
            {vehicles.length > 0 && (
              <div className="flex flex-col gap-1 mb-3">
                {vehicles.map((v) => (
                  <p key={v.id} className="text-sm text-gray-700">🚗 {v.make} {v.model} — {t(`category_${v.vehicle_category}`)} ({v.plate_number})</p>
                ))}
              </div>
            )}
            {showVehicleForm ? (
              <form onSubmit={handleRegisterVehicle} className="grid grid-cols-2 gap-2">
                <select value={vehicleCategory} onChange={(e) => setVehicleCategory(e.target.value)} className="border rounded-lg px-3 py-2">
                  {RIDE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{t(`category_${cat}`)}</option>)}
                </select>
                <input required placeholder={t("plateNumberPlaceholder")} value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} className="border rounded-lg px-3 py-2" />
                <input required placeholder={t("makePlaceholder")} value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} className="border rounded-lg px-3 py-2" />
                <input required placeholder={t("modelPlaceholder")} value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className="border rounded-lg px-3 py-2" />
                <Button className="col-span-2">{t("registerVehicle")}</Button>
              </form>
            ) : (
              <Button variant="secondary" onClick={() => setShowVehicleForm(true)}>{t("addVehicle")}</Button>
            )}
          </div>
        )}
      </div>

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : rides.length === 0 ? (
        <EmptyState icon="🚕" title={t("noRidesYet")} />
      ) : (
        <div className="flex flex-col gap-3">
          {rideActionError && <p className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{rideActionError}</p>}
          {rides.map((ride) => (
            <div key={ride.id} className="border border-gray-200 rounded-xl p-4 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <p className="text-sm font-semibold text-[var(--navy)]">{ride.pickup_description} → {ride.dropoff_description}</p>
                <Badge variant={STATUS_VARIANT[ride.status] || "neutral"}>{ride.status.replace("_", " ")}</Badge>
              </div>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <Badge variant="neutral">{t(`category_${ride.ride_category}`)}</Badge>
                {ride.transport_type === "CARGO" && <Badge variant="gold">{t("transportCargo")}</Badge>}
                {ride.has_luggage && <Badge variant="neutral">🧳 {t("hasLuggageLabel")}</Badge>}
              </div>
              {ride.cargo_description && <p className="text-xs text-gray-500 mb-2">{ride.cargo_description}</p>}
              <p className="text-sm text-gray-600 mb-3">{Number(ride.fare_estimate_xaf).toLocaleString()} XAF</p>

              {ride.driver && ride.status !== "CANCELLED" && (
                <p className="text-xs text-gray-600 mb-3">
                  {ride.rider === myUserId ? t("yourDriver", { name: ride.driver_name ?? "" }) : t("yourRider", { name: ride.rider_name })}
                  {ride.vehicle_details && ` · ${ride.vehicle_details.make} ${ride.vehicle_details.model} · ${ride.vehicle_details.plate_number}`}
                </p>
              )}
              {/* Both-ends GPS navigation for Rider and Driver */}
              {(ride.pickup_latitude && ride.pickup_longitude) || (ride.dropoff_latitude && ride.dropoff_longitude) ? (
                <div className="flex flex-wrap items-center gap-2 mb-3 p-2.5 bg-slate-50 rounded-xl border border-slate-200/80">
                  {ride.pickup_latitude && ride.pickup_longitude && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${ride.pickup_latitude},${ride.pickup_longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors shadow-2xs"
                      title="Follow GPS coordinates to rider pickup spot"
                    >
                      <IconMapPin size={13} />
                      <span>Follow to Pickup (Google Maps ↗)</span>
                    </a>
                  )}

                  {ride.dropoff_latitude && ride.dropoff_longitude && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${ride.dropoff_latitude},${ride.dropoff_longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-2xs"
                      title="Follow GPS coordinates to dropoff destination"
                    >
                      <IconCompass size={13} />
                      <span>Follow to Dropoff (Google Maps ↗)</span>
                    </a>
                  )}
                </div>
              ) : null}

              {ride.status === "REQUESTED" && canDrive && acceptingRideId !== ride.id && (
                <button onClick={() => setAcceptingRideId(ride.id)} className="text-xs text-[var(--navy)] underline">{t("acceptAsDriver")}</button>
              )}
              {acceptingRideId === ride.id && (
                <div className="flex gap-2 mt-2">
                  <select value={selectedVehicleId ?? ""} onChange={(e) => setSelectedVehicleId(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm flex-1">
                    <option value="" disabled>{t("chooseVehicle")}</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{v.make} {v.model} ({t(`category_${v.vehicle_category}`)})</option>)}
                  </select>
                  <button onClick={() => handleAccept(ride.id)} className="bg-[var(--navy)] text-white font-semibold px-3 py-1.5 rounded text-sm">{t("confirm")}</button>
                </div>
              )}
              {ride.status === "ACCEPTED" && ride.driver === myUserId && (
                <button onClick={() => handleStart(ride.id)} className="text-xs text-[var(--navy)] underline">{t("startRide")}</button>
              )}
              {ride.status === "ACCEPTED" && ride.driver === myUserId && (
                <button onClick={() => runRideAction((token) => releaseRide(ride.id, token))} className="ml-3 text-xs text-slate-600 underline">{t("releaseRide")}</button>
              )}
              {(ride.status === "REQUESTED" || ride.status === "ACCEPTED") && ride.rider === myUserId && (
                <button onClick={() => handleCancel(ride.id)} className="ml-3 text-xs text-red-700 underline">{t("cancelRide")}</button>
              )}
              {(ride.status === "ACCEPTED" || ride.status === "IN_PROGRESS") && (ride.rider === myUserId || ride.driver === myUserId) && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <button onClick={() => handleSos(ride.id)} className="text-xs font-bold text-white bg-red-700 hover:bg-red-800 rounded-lg px-3 py-1.5 cursor-pointer">
                    🆘 {t("sosButton")}
                  </button>
                  {sosMessage?.rideId === ride.id && <p className="text-xs text-slate-700 mt-2">{sosMessage.text}</p>}
                </div>
              )}
              {ride.status === "IN_PROGRESS" && payingRideId !== ride.id && (
                <button onClick={() => setPayingRideId(ride.id)} className="text-xs text-[var(--navy)] underline">{t("completeAndPay")}</button>
              )}
              {payingRideId === ride.id && (
                <div className="flex gap-2 mt-2">
                  <input placeholder={t("phoneNumberPlaceholder")} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="border rounded px-3 py-1.5 text-sm flex-1" />
                  <button onClick={() => handleComplete(ride.id)} className="bg-[var(--gold)] text-[var(--navy)] font-semibold px-3 py-1.5 rounded text-sm">{t("pay")}</button>
                </div>
              )}

              {ride.status === "COMPLETED" && (() => {
                const otherId = ride.rider === myUserId ? ride.driver : ride.rider;
                return otherId ? (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">{t("rateTrip")}</p>
                    <RateAndReport subjectUserId={otherId} />
                  </div>
                ) : null;
              })()}

              {/* Private In-Trip Chat between Rider & Driver */}
              {ride.driver && (ride.status === "ACCEPTED" || ride.status === "IN_PROGRESS") && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => setActiveChatRideId(activeChatRideId === ride.id ? null : ride.id)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--navy)] hover:underline"
                  >
                    <span>💬 {activeChatRideId === ride.id ? t("hideChat") || "Hide Chat" : t("openChat") || "Chat with Driver/Rider"}</span>
                  </button>

                  {activeChatRideId === ride.id && (
                    <RideChat rideId={ride.id} myUserId={myUserId} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

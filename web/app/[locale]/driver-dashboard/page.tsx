"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  getMyDriverProfile,
  listMyVehicles,
  listMyRides,
  registerAsDriver,
  registerVehicle,
  getMyProfile,
  type DriverProfileItem,
  type VehicleItem,
  type RideBookingItem,
} from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import {
  IconCar,
  IconShieldCheck,
  IconAlertCircle,
  IconCheckCircle,
  IconCreditCard,
  IconClock,
  IconMapPin,
  IconChevronRight,
  IconShare,
  IconQrCode,
  IconArrowUpRight,
} from "@/components/Icons";
import Button from "@/components/ui/Button";
import WalletPayoutCard from "@/components/WalletPayoutCard";

export default function DriverDashboardPage() {
  const [profile, setProfile] = useState<DriverProfileItem | null>(null);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [rides, setRides] = useState<RideBookingItem[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [userId, setUserId] = useState<string>("");
  const [showShareModal, setShowShareModal] = useState(false);

  // Registration state if not yet registered
  const [licenseNumber, setLicenseNumber] = useState("");
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState("");

  // New vehicle state
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [vehicleCategory, setVehicleCategory] = useState("STANDARD");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [vehicleError, setVehicleError] = useState("");

  const loadData = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setStatus("signedOut");
      return;
    }

    Promise.all([
      getMyDriverProfile(token).catch(() => null),
      listMyVehicles(token).catch(() => ({ results: [] })),
      listMyRides(token).catch(() => ({ results: [] })),
      getMyProfile(token).catch(() => null),
    ])
      .then(([prof, vehs, rds, myProf]) => {
        setProfile(prof);
        setVehicles(vehs.results || []);
        setRides(rds.results || []);
        if (myProf) setUserId(myProf.id);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  };

  useEffect(() => {
    loadData();
  }, []);

  async function handleRegisterDriver(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRegistering(true);
    setRegError("");
    try {
      await registerAsDriver(licenseNumber, token);
      loadData();
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  }

  async function handleAddVehicle(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setVehicleError("");
    try {
      await registerVehicle(
        { vehicle_category: vehicleCategory, make: vehicleMake, model: vehicleModel, plate_number: plateNumber },
        token
      );
      setShowVehicleModal(false);
      setVehicleMake("");
      setVehicleModel("");
      setPlateNumber("");
      loadData();
    } catch (err) {
      setVehicleError(err instanceof Error ? err.message : "Vehicle registration failed");
    }
  }

  if (status === "signedOut") {
    return (
      <DashboardLayout
        currentRole="driver"
        activeHref="/driver-dashboard"
        title="OaziGo Driver Dashboard"
        subtitle="Manage your registered vehicles, ride history, and active transport requests."
      >
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4 font-semibold text-sm">Please sign in to access your Driver Dashboard.</p>
          <Button href="/login">Sign In</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading") {
    return (
      <DashboardLayout
        currentRole="driver"
        activeHref="/driver-dashboard"
        title="OaziGo Driver Dashboard"
      >
        <div className="text-center py-20 text-slate-400">Loading driver dashboard...</div>
      </DashboardLayout>
    );
  }

  const completedRides = rides.filter((r) => r.status === "COMPLETED");
  const activeRides = rides.filter((r) => r.status === "ACCEPTED" || r.status === "IN_PROGRESS");
  const estimatedRevenue = completedRides.reduce((acc, r) => acc + Number(r.fare_estimate_xaf || 0), 0);

  const shareUrl = typeof window !== "undefined" && userId ? `${window.location.origin}/user/${userId}` : "";

  return (
    <DashboardLayout
      currentRole="driver"
      activeHref="/driver-dashboard"
      title="OaziGo Driver Dashboard"
      subtitle="Manage your registered vehicles, track ride trips, and inspect completed earnings."
      badge={profile?.is_verified ? "Verified Driver" : profile ? "Pending Verification" : "Not Registered"}
      action={
        <div className="flex items-center gap-2">
          {userId && (
            <>
              <Link
                href={`/user/${userId}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors shadow-2xs"
              >
                <span>Public Profile</span>
                <IconArrowUpRight size={14} />
              </Link>
              <button
                type="button"
                onClick={() => setShowShareModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-amber-300 hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
              >
                <IconQrCode size={15} />
                <IconShare size={14} />
                <span>Share & QR</span>
              </button>
            </>
          )}
          <Link
            href="/oazigo"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
          >
            <span>Open Live Ride Queue</span>
            <IconChevronRight size={14} />
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Verification Status Banner */}
        {!profile ? (
          <div className="p-6 rounded-3xl bg-amber-50 border border-amber-200/80">
            <h3 className="text-sm font-black text-amber-950 flex items-center gap-2 mb-1">
              <IconAlertCircle size={16} className="text-amber-600" />
              <span>Driver Registration Required</span>
            </h3>
            <p className="text-xs text-amber-900/80 mb-4 leading-relaxed">
              Register your driver license to start accepting passenger and cargo rides across your city.
            </p>
            <form onSubmit={handleRegisterDriver} className="flex flex-col sm:flex-row gap-3 max-w-lg">
              <input
                type="text"
                required
                placeholder="Driver License Number (e.g. DL-2026-991)"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-amber-300 bg-white"
              />
              <button
                type="submit"
                disabled={registering}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-colors disabled:opacity-50"
              >
                {registering ? "Submitting..." : "Register as Driver"}
              </button>
            </form>
            {regError && <p className="text-xs text-rose-600 mt-2">{regError}</p>}
          </div>
        ) : !profile.is_verified ? (
          <div className="p-5 rounded-3xl bg-amber-50/70 border border-amber-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <IconClock size={20} />
            </div>
            <div>
              <p className="text-xs font-black text-amber-950">Driver Verification Pending Review</p>
              <p className="text-[11px] text-amber-800/80">
                License <span className="font-bold">{profile.license_number}</span> is under audit by Oaziland compliance. You can register your vehicles now.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-5 rounded-3xl bg-emerald-50/80 border border-emerald-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              <IconShieldCheck size={20} />
            </div>
            <div>
              <p className="text-xs font-black text-emerald-950">Active Vetted OaziGo Driver</p>
              <p className="text-[11px] text-emerald-800/80">
                License <span className="font-bold">{profile.license_number}</span> verified. You can accept passenger rides and cargo trips.
              </p>
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
            <p className="text-xs font-semibold text-slate-500 mb-1">Registered Vehicles</p>
            <p className="text-2xl font-black text-slate-900">{vehicles.length}</p>
            <p className="text-[11px] text-slate-400 mt-1">Ready for ride allocation</p>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
            <p className="text-xs font-semibold text-slate-500 mb-1">Completed Trips</p>
            <p className="text-2xl font-black text-emerald-600">{completedRides.length}</p>
            <p className="text-[11px] text-slate-400 mt-1">{activeRides.length} active in progress</p>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
            <p className="text-xs font-semibold text-slate-500 mb-1">Estimated Gross Fare</p>
            <p className="text-2xl font-black text-slate-900">
              {estimatedRevenue.toLocaleString()} <span className="text-xs font-medium text-slate-400">XAF</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-1">From completed journeys</p>
          </div>
        </div>

        {/* Registered Fleet / Vehicles Section */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Your Vehicle Fleet</h3>
              <p className="text-xs text-slate-500">Vehicles authorized to operate on OaziGo</p>
            </div>
            <button
              onClick={() => setShowVehicleModal(true)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              + Add Vehicle
            </button>
          </div>

          {vehicles.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No vehicles registered yet. Add a moto, car, van, or truck to accept rides.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {vehicles.map((v) => (
                <div key={v.id} className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">
                      {v.vehicle_category}
                    </span>
                    <p className="text-xs font-bold text-slate-900 pt-1">
                      {v.make} {v.model}
                    </p>
                    <p className="text-[11px] text-slate-500 font-medium">Plate: {v.plate_number}</p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 shadow-xs">
                    <IconCar size={18} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Vehicle Modal Form */}
        {showVehicleModal && (
          <div className="p-5 rounded-3xl bg-slate-900 text-white space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold">Register New Vehicle</h4>
              <button
                onClick={() => setShowVehicleModal(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✕ Cancel
              </button>
            </div>
            <form onSubmit={handleAddVehicle} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <select
                value={vehicleCategory}
                onChange={(e) => setVehicleCategory(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-800 border border-slate-700 text-white"
              >
                <option value="MOTO">Moto</option>
                <option value="STANDARD">Standard</option>
                <option value="COMFORT">Comfort</option>
                <option value="VAN">Van</option>
                <option value="TRUCK">Truck</option>
              </select>
              <input
                required
                placeholder="Make (e.g. Toyota)"
                value={vehicleMake}
                onChange={(e) => setVehicleMake(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-800 border border-slate-700 text-white"
              />
              <input
                required
                placeholder="Model (e.g. Yaris)"
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-800 border border-slate-700 text-white"
              />
              <input
                required
                placeholder="Plate (e.g. LT 482 AC)"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-800 border border-slate-700 text-white"
              />
              <div className="sm:col-span-4 flex justify-end gap-2 pt-1">
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300"
                >
                  Save Vehicle
                </button>
              </div>
            </form>
            {vehicleError && <p className="text-xs text-rose-400">{vehicleError}</p>}
          </div>
        )}

        {/* Recent Ride Activity */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Recent Rides Log</h3>
              <p className="text-xs text-slate-500">History of your ride bookings and trips</p>
            </div>
          </div>

          {rides.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No rides in your log yet. Head to the live queue to accept new trips.
            </div>
          ) : (
            <div className="space-y-3">
              {rides.slice(0, 8).map((ride) => (
                <div
                  key={ride.id}
                  className="p-4 rounded-2xl border border-slate-200/80 hover:border-slate-300 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {ride.ride_category}
                      </span>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                        {ride.status}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(ride.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5 pt-0.5">
                      <IconMapPin size={13} className="text-amber-500 shrink-0" />
                      <span>{ride.pickup_description} → {ride.dropoff_description}</span>
                    </p>

                    {(ride.pickup_latitude && ride.pickup_longitude) || (ride.dropoff_latitude && ride.dropoff_longitude) ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1.5">
                        {ride.pickup_latitude && ride.pickup_longitude && (
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${ride.pickup_latitude},${ride.pickup_longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors"
                          >
                            <span>Navigate Pickup (Google Maps ↗)</span>
                          </a>
                        )}
                        {ride.dropoff_latitude && ride.dropoff_longitude && (
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${ride.dropoff_latitude},${ride.dropoff_longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                          >
                            <span>Navigate Dropoff (Google Maps ↗)</span>
                          </a>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="text-left sm:text-right">
                    <p className="text-sm font-black text-slate-900">
                      {Number(ride.fare_estimate_xaf).toLocaleString()} XAF
                    </p>
                    <p className="text-[11px] text-slate-400">{ride.distance_km} km journey</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Real Mobile Money Payout & Withdrawal Module */}
        <WalletPayoutCard
          title="OaziGo Driver Wallet & Mobile Money Payouts"
          subtitle="Instant cash-out of trip fares and cargo earnings directly to your MTN MoMo or Orange Money."
        />
      </div>

      {userId && (
        <ShareAndQrModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          url={shareUrl}
          title="My OaziGo Driver Profile"
          subtitle="Share your verified driver and transport fleet profile and QR code with riders and clients."
        />
      )}
    </DashboardLayout>
  );
}

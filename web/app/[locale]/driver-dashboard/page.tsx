"use client";
import { useState, useEffect, useCallback } from "react";
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
  IconClock,
  IconChevronRight,
  IconShare,
  IconQrCode,
  IconArrowUpRight,
} from "@/components/Icons";
import Button from "@/components/ui/Button";
import WalletPayoutCard from "@/components/WalletPayoutCard";
import DriverEarnings from "@/components/oazigo/DriverEarnings";
import { RIDE_CATEGORIES } from "@/components/oazigo/styles";

export default function DriverDashboardPage() {
  const t = useTranslations("DriverDashboardPage");
  const tOz = useTranslations("OaziGoPage");
  const [profile, setProfile] = useState<DriverProfileItem | null>(null);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [rides, setRides] = useState<RideBookingItem[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [userId, setUserId] = useState<string>("");
  const [showShareModal, setShowShareModal] = useState(false);

  const [licenseNumber, setLicenseNumber] = useState("");
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState("");

  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [vehicleCategory, setVehicleCategory] = useState("STANDARD");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [vehicleError, setVehicleError] = useState("");

  const fetchData = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return null;
    return Promise.all([
      getMyDriverProfile(token).catch(() => null),
      listMyVehicles(token).catch(() => ({ results: [] })),
      listMyRides(token).catch(() => ({ results: [] })),
      getMyProfile(token).catch(() => null),
    ]).catch(() => undefined);
  }, []);

  const applyData = useCallback((data: Awaited<NonNullable<ReturnType<typeof fetchData>>> | null) => {
    if (data === null) {
      setStatus("signedOut");
      return;
    }
    if (data) {
      const [prof, vehs, rds, myProf] = data;
      setProfile(prof);
      setVehicles(vehs.results || []);
      setRides(rds.results || []);
      if (myProf) setUserId(myProf.id);
    }
    setStatus("ready");
  }, []);

  const loadData = useCallback(() => {
    const pending = fetchData();
    if (pending) pending.then(applyData);
    else applyData(null);
  }, [fetchData, applyData]);

  useEffect(() => {
    const pending = fetchData();
    if (pending) pending.then(applyData);
    else Promise.resolve().then(() => applyData(null));
  }, [fetchData, applyData]);

  async function handleRegisterDriver(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRegistering(true);
    setRegError("");
    try {
      await registerAsDriver(licenseNumber.trim(), token);
      loadData();
    } catch {
      setRegError(t("registrationFailed"));
    } finally {
      setRegistering(false);
    }
  }

  async function handleAddVehicle(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || savingVehicle) return;
    setSavingVehicle(true);
    setVehicleError("");
    try {
      await registerVehicle(
        { vehicle_category: vehicleCategory, make: vehicleMake.trim(), model: vehicleModel.trim(), plate_number: plateNumber.trim() },
        token
      );
      setShowVehicleModal(false);
      setVehicleMake("");
      setVehicleModel("");
      setPlateNumber("");
      loadData();
    } catch {
      setVehicleError(t("vehicleFailed"));
    } finally {
      setSavingVehicle(false);
    }
  }

  if (status === "signedOut") {
    return (
      <DashboardLayout currentRole="driver" activeHref="/driver-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4 font-semibold text-sm">{t("signInPrompt")}</p>
          <Button href="/login">{t("signIn")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading") {
    return (
      <DashboardLayout currentRole="driver" activeHref="/driver-dashboard" title={t("title")}>
        <div className="space-y-4" aria-busy="true" aria-label={t("loading")}>
          <div className="h-20 rounded-3xl bg-slate-100 animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
            <div className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
          </div>
          <div className="h-48 rounded-3xl bg-slate-100 animate-pulse" />
        </div>
      </DashboardLayout>
    );
  }

  const shareUrl = typeof window !== "undefined" && userId ? `${window.location.origin}/user/${userId}` : "";
  const darkFieldCls = "px-3 py-2 text-xs rounded-xl bg-slate-800 border border-slate-700 text-white";

  return (
    <DashboardLayout
      currentRole="driver"
      activeHref="/driver-dashboard"
      title={t("title")}
      subtitle={t("subtitle")}
      badge={profile?.is_verified ? t("badgeVerified") : profile ? t("badgePending") : t("badgeNotRegistered")}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {userId && (
            <>
              <Link
                href={`/user/${userId}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors shadow-2xs"
              >
                <span>{t("publicProfile")}</span>
                <IconArrowUpRight size={14} />
              </Link>
              <button
                type="button"
                onClick={() => setShowShareModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-amber-300 hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
              >
                <IconQrCode size={15} />
                <IconShare size={14} />
                <span>{t("shareQr")}</span>
              </button>
            </>
          )}
          <Link
            href={profile?.is_verified ? "/oazigo/requests" : "/oazigo/drive"}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
          >
            <span>{profile?.is_verified ? t("openLiveQueue") : tOz("navDrive")}</span>
            <IconChevronRight size={14} />
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {!profile ? (
          <div className="p-6 rounded-3xl bg-amber-50 border border-amber-200/80">
            <h3 className="text-sm font-black text-amber-950 flex items-center gap-2 mb-1">
              <IconAlertCircle size={16} className="text-amber-600" />
              <span>{t("registrationRequiredTitle")}</span>
            </h3>
            <p className="text-xs text-amber-900/80 mb-4 leading-relaxed">{t("registrationRequiredBody")}</p>
            <form onSubmit={handleRegisterDriver} className="flex flex-col sm:flex-row gap-3 max-w-lg">
              <input
                type="text"
                required
                aria-label={t("licensePlaceholder")}
                placeholder={t("licensePlaceholder")}
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-amber-300 bg-white"
              />
              <button
                type="submit"
                disabled={registering || !licenseNumber.trim()}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-colors disabled:opacity-50"
              >
                {registering ? t("submitting") : t("registerAsDriver")}
              </button>
            </form>
            {regError && <p role="alert" className="text-xs text-rose-600 mt-2">{regError}</p>}
          </div>
        ) : !profile.is_verified ? (
          <div className="p-5 rounded-3xl bg-amber-50/70 border border-amber-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <IconClock size={20} />
            </div>
            <div>
              <p className="text-xs font-black text-amber-950">{t("pendingTitle")}</p>
              <p className="text-[11px] text-amber-800/80">{t("pendingBody", { license: profile.license_number })}</p>
            </div>
          </div>
        ) : (
          <div className="p-5 rounded-3xl bg-emerald-50/80 border border-emerald-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
              <IconShieldCheck size={20} />
            </div>
            <div>
              <p className="text-xs font-black text-emerald-950">{t("verifiedTitle")}</p>
              <p className="text-[11px] text-emerald-800/80">{t("verifiedBody", { license: profile.license_number })}</p>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                {t("fleetTitle")}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{vehicles.length}</span>
              </h3>
              <p className="text-xs text-slate-500">{t("fleetSubtitle")}</p>
            </div>
            {profile && (
              <button
                type="button"
                onClick={() => setShowVehicleModal(true)}
                className="shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
              >
                {t("addVehicle")}
              </button>
            )}
          </div>

          {vehicles.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">{t("noVehicles")}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {vehicles.map((v) => (
                <div key={v.id} className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">
                      {tOz(`category_${v.vehicle_category}`)}
                    </span>
                    <p className="text-xs font-bold text-slate-900 pt-1">
                      {v.make} {v.model}
                    </p>
                    <p className="text-[11px] text-slate-500 font-medium">{t("plate", { plate: v.plate_number })}</p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 shadow-xs">
                    <IconCar size={18} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showVehicleModal && (
          <div className="p-5 rounded-3xl bg-slate-900 text-white space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold">{t("newVehicleTitle")}</h4>
              <button type="button" onClick={() => setShowVehicleModal(false)} className="text-xs text-slate-400 hover:text-white">
                ✕ {t("cancel")}
              </button>
            </div>
            <form onSubmit={handleAddVehicle} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <select
                aria-label={tOz("vehicleCategoryLabel")}
                value={vehicleCategory}
                onChange={(e) => setVehicleCategory(e.target.value)}
                className={darkFieldCls}
              >
                {RIDE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{tOz(`category_${cat}`)}</option>
                ))}
              </select>
              <input required aria-label={t("makePlaceholder")} placeholder={t("makePlaceholder")} value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} className={darkFieldCls} />
              <input required aria-label={t("modelPlaceholder")} placeholder={t("modelPlaceholder")} value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className={darkFieldCls} />
              <input required aria-label={t("platePlaceholder")} placeholder={t("platePlaceholder")} value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} className={darkFieldCls} />
              <div className="sm:col-span-4 flex justify-end gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingVehicle}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 disabled:opacity-50"
                >
                  {savingVehicle ? t("saving") : t("saveVehicle")}
                </button>
              </div>
            </form>
            {vehicleError && <p role="alert" className="text-xs text-rose-400">{vehicleError}</p>}
          </div>
        )}

        <DriverEarnings rides={rides} driverId={userId || null} />

        <WalletPayoutCard title={tOz("walletTitle")} subtitle={tOz("walletSubtitle")} />
      </div>

      {userId && (
        <ShareAndQrModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          url={shareUrl}
          title={t("shareTitle")}
          subtitle={t("shareSubtitle")}
        />
      )}
    </DashboardLayout>
  );
}

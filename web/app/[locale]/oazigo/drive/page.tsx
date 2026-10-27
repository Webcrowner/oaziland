"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { registerAsDriver, registerVehicle } from "@/lib/api";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { IconCar, IconCheckCircle, IconAlertCircle } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import { RIDE_CATEGORIES, cardCls, inputCls } from "@/components/oazigo/styles";

export default function OaziGoDrivePage() {
  const t = useTranslations("OaziGoPage");
  const { status, driverProfile, vehicles, reload } = useOaziGo();

  const [showDriverForm, setShowDriverForm] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [vehicleCategory, setVehicleCategory] = useState<string>("STANDARD");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [plateNumber, setPlateNumber] = useState("");

  async function handleRegisterDriver(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await registerAsDriver(licenseNumber, token);
    setShowDriverForm(false);
    setLicenseNumber("");
    reload();
  }

  async function handleRegisterVehicle(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await registerVehicle({ vehicle_category: vehicleCategory, make: vehicleMake, model: vehicleModel, plate_number: plateNumber }, token);
    setShowVehicleForm(false);
    setVehicleMake(""); setVehicleModel(""); setPlateNumber("");
    reload();
  }

  return (
    <div className={cardCls}>
      <h1 className="text-xl font-black tracking-tight text-slate-900 mb-3">{t("wantToDriveTitle")}</h1>

      {status === "loading" ? (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
      ) : !driverProfile ? (
        showDriverForm ? (
          <form onSubmit={handleRegisterDriver} className="flex flex-col sm:flex-row gap-2">
            <input required placeholder={t("licenseNumberPlaceholder")} value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} className={`${inputCls} sm:flex-1`} />
            <Button variant="dark">{t("register")}</Button>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setShowDriverForm(true)}>{t("registerAsDriver")}</Button>
        )
      ) : !driverProfile.is_verified ? (
        <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          <IconAlertCircle size={18} className="shrink-0" /> {t("driverPendingVerification")}
        </p>
      ) : (
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <IconCheckCircle size={18} className="shrink-0" /> {t("verifiedDriver")}
          </p>
          {vehicles.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {vehicles.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm">
                  <IconCar size={16} className="shrink-0 text-slate-500" />
                  <span className="font-bold text-slate-900">{v.make} {v.model}</span>
                  <Badge variant="neutral">{t(`category_${v.vehicle_category}`)}</Badge>
                  <span className="font-mono text-xs text-slate-500">{v.plate_number}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            {showVehicleForm ? (
              <form onSubmit={handleRegisterVehicle} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select value={vehicleCategory} onChange={(e) => setVehicleCategory(e.target.value)} className={inputCls}>
                  {RIDE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{t(`category_${cat}`)}</option>)}
                </select>
                <input required placeholder={t("plateNumberPlaceholder")} value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} className={inputCls} />
                <input required placeholder={t("makePlaceholder")} value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} className={inputCls} />
                <input required placeholder={t("modelPlaceholder")} value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className={inputCls} />
                <Button variant="dark" className="sm:col-span-2">{t("registerVehicle")}</Button>
              </form>
            ) : (
              <Button variant="secondary" onClick={() => setShowVehicleForm(true)}>{t("addVehicle")}</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleRegisterDriver(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await registerAsDriver(licenseNumber.trim(), token);
      setShowDriverForm(false);
      setLicenseNumber("");
      reload();
    } catch {
      setError(t("registerDriverFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegisterVehicle(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await registerVehicle(
        { vehicle_category: vehicleCategory, make: vehicleMake.trim(), model: vehicleModel.trim(), plate_number: plateNumber.trim() },
        token,
      );
      setShowVehicleForm(false);
      setVehicleMake(""); setVehicleModel(""); setPlateNumber("");
      reload();
    } catch {
      setError(t("registerVehicleFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function closeForms() {
    setShowDriverForm(false);
    setShowVehicleForm(false);
    setError("");
  }

  const errorBox = error && (
    <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
      <IconAlertCircle size={18} className="mt-0.5 shrink-0" /> {error}
    </p>
  );

  const steps = [
    { label: t("driveStepRegister"), done: Boolean(driverProfile) },
    { label: t("driveStepVerify"), done: Boolean(driverProfile?.is_verified) },
    { label: t("driveStepVehicle"), done: vehicles.length > 0 },
    { label: t("driveStepOnline"), done: Boolean(driverProfile?.is_online) },
  ];
  const currentStep = steps.findIndex((s) => !s.done);

  return (
    <div className="flex flex-col gap-4">
    {status !== "loading" && (
      <section className={cardCls} aria-labelledby="drive-steps">
        <p id="drive-steps" className="mb-3 text-sm text-slate-600">{t("driveIntro")}</p>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {steps.map((step, i) => {
            const isCurrent = i === currentStep;
            return (
              <li
                key={step.label}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-sm ${
                  step.done ? "border-emerald-200 bg-emerald-50/60" : isCurrent ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                    step.done ? "bg-emerald-500 text-white" : isCurrent ? "bg-slate-900 text-amber-300" : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {step.done ? <IconCheckCircle size={15} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-bold ${step.done ? "text-emerald-900" : "text-slate-900"}`}>{step.label}</span>
                  {(step.done || isCurrent) && (
                    <span className={`block text-[11px] font-semibold ${step.done ? "text-emerald-700" : "text-amber-700"}`}>
                      {step.done ? t("driveStepDone") : t("driveStepCurrent")}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    )}
    <div className={cardCls}>
      <h1 className="text-xl font-black tracking-tight text-slate-900 mb-3">{driverProfile ? t("driveTitleDriver") : t("wantToDriveTitle")}</h1>

      {status === "loading" ? (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
      ) : !driverProfile ? (
        showDriverForm ? (
          <>
            <form onSubmit={handleRegisterDriver} className="flex flex-col sm:flex-row gap-2">
              <input
                required autoFocus aria-label={t("licenseNumberPlaceholder")} placeholder={t("licenseNumberPlaceholder")}
                value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} className={`${inputCls} sm:flex-1`}
              />
              <Button variant="dark" disabled={submitting || !licenseNumber.trim()}>{submitting ? t("submitting") : t("register")}</Button>
              <Button type="button" variant="secondary" onClick={closeForms} disabled={submitting}>{t("cancel")}</Button>
            </form>
            {errorBox}
          </>
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
          {vehicles.length > 0 ? (
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
          ) : (
            <p className="mt-3 text-sm text-slate-500">{t("addVehicleToDrive")}</p>
          )}
          <div className="mt-3">
            {showVehicleForm ? (
              <>
                <form onSubmit={handleRegisterVehicle} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select aria-label={t("vehicleCategoryLabel")} value={vehicleCategory} onChange={(e) => setVehicleCategory(e.target.value)} className={inputCls}>
                    {RIDE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{t(`category_${cat}`)}</option>)}
                  </select>
                  <input required aria-label={t("plateNumberPlaceholder")} placeholder={t("plateNumberPlaceholder")} value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} className={inputCls} />
                  <input required aria-label={t("makePlaceholder")} placeholder={t("makePlaceholder")} value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} className={inputCls} />
                  <input required aria-label={t("modelPlaceholder")} placeholder={t("modelPlaceholder")} value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className={inputCls} />
                  <div className="flex gap-2 sm:col-span-2">
                    <Button variant="dark" className="flex-1" disabled={submitting}>{submitting ? t("submitting") : t("registerVehicle")}</Button>
                    <Button type="button" variant="secondary" onClick={closeForms} disabled={submitting}>{t("cancel")}</Button>
                  </div>
                </form>
                {errorBox}
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant={vehicles.length === 0 ? "dark" : "secondary"} onClick={() => setShowVehicleForm(true)}>{t("addVehicle")}</Button>
                {vehicles.length > 0 && <Button variant="dark" href="/oazigo/requests">{t("goToOpenRequests")}</Button>}
                <Button variant="secondary" href="/oazigo/earnings">{t("navEarnings")}</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

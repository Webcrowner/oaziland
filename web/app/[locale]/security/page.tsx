"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { changePassword, getMfaStatus } from "@/lib/api";
import { Link } from "@/i18n/navigation";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import Button from "@/components/ui/Button";
import {
  IconLock,
  IconShieldCheck,
  IconEye,
  IconEyeOff,
  IconCheckCircle,
  IconAlertCircle,
  IconChevronRight,
} from "@/components/Icons";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-3.5 pr-11 py-2.5 text-sm text-slate-900 transition focus:bg-white focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15";

const STRENGTH = [
  { label: "Too weak", bar: "bg-red-500", text: "text-red-600" },
  { label: "Weak", bar: "bg-red-500", text: "text-red-600" },
  { label: "Fair", bar: "bg-amber-500", text: "text-amber-600" },
  { label: "Good", bar: "bg-lime-500", text: "text-lime-600" },
  { label: "Strong", bar: "bg-emerald-500", text: "text-emerald-600" },
];

function passwordChecks(pw: string) {
  return [
    { label: "At least 8 characters", ok: pw.length >= 8 },
    { label: "Upper and lower case letters", ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: "At least one number", ok: /\d/.test(pw) },
    { label: "At least one symbol", ok: /[^A-Za-z0-9]/.test(pw) },
  ];
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          required
          minLength={8}
          autoComplete={autoComplete}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
        >
          {visible ? <IconEyeOff size={18} /> : <IconEye size={18} />}
        </button>
      </div>
    </div>
  );
}

/**
 * Password/security settings, plus an OPTIONAL two-factor authentication
 * toggle — MFA is no longer a mandatory gate on sensitive actions
 * (KYC alone is, enforced platform-wide by IsKycVerified), just a real
 * extra-security feature a user can turn on for themselves here.
 */
export default function SecurityPage() {
  const t = useTranslations("SecurityPage");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMfaStatus(token).then((r) => setMfaEnabled(r.mfa_enabled)).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("passwordsDontMatch"));
      setStatus("error");
      return;
    }
    setError("");
    setStatus("submitting");
    try {
      await changePassword(currentPassword, newPassword, token);
      setStatus("success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("changeFailed"));
      setStatus("error");
    }
  }

  const checks = passwordChecks(newPassword);
  const score = newPassword ? checks.filter((c) => c.ok).length : 0;
  const strength = STRENGTH[score];
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  return (
    <AccountSidebarLayout activeHref="/security">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative p-6 sm:p-8 flex items-center gap-5">
          <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
            <IconLock size={28} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-2 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-sm flex flex-col gap-5"
        >
          <h2 className="text-lg font-black tracking-tight text-slate-900">{t("changeButton")}</h2>

          <PasswordField id="current-password" label={t("currentPassword")} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PasswordField id="new-password" label={t("newPassword")} value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
            <PasswordField id="confirm-password" label={t("confirmPassword")} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
          </div>

          {newPassword && (
            <div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= score ? strength.bar : "bg-slate-200"}`} />
                ))}
              </div>
              <p className={`mt-1.5 text-xs font-bold ${strength.text}`}>{strength.label}</p>
            </div>
          )}

          {mismatch && <p className="text-xs font-semibold text-red-600">{t("passwordsDontMatch")}</p>}

          {status === "error" && (
            <p className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              <IconAlertCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          {status === "success" && (
            <p className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
              <IconCheckCircle size={16} className="mt-0.5 shrink-0" />
              {t("changeSuccess")}
            </p>
          )}

          <div className="flex justify-end">
            <Button disabled={status === "submitting"}>{status === "submitting" ? t("submitting") : t("changeButton")}</Button>
          </div>
        </form>

        <div className="flex flex-col gap-6">
          <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${mfaEnabled ? "bg-emerald-50 text-emerald-600" : "bg-slate-900 text-amber-300"}`}>
                <IconShieldCheck size={22} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-black text-slate-900">{t("mfaTitle")}</h2>
                  {mfaEnabled !== null && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${mfaEnabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                      {mfaEnabled ? "On" : "Off"}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">{mfaEnabled ? t("mfaEnabledDesc") : t("mfaDisabledDesc")}</p>
              </div>
            </div>
            {!mfaEnabled && (
              <Link
                href="/mfa-setup"
                className="mt-5 flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
              >
                <span>{t("mfaEnableButton")}</span>
                <IconChevronRight size={16} className="text-amber-300" />
              </Link>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-4">Strong password</h2>
            <ul className="flex flex-col gap-2.5">
              {checks.map((c) => (
                <li key={c.label} className={`flex items-center gap-2 text-sm ${c.ok ? "text-emerald-700" : "text-slate-500"}`}>
                  <IconCheckCircle size={16} className={c.ok ? "text-emerald-500" : "text-slate-300"} />
                  {c.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AccountSidebarLayout>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { setupMfa, verifyMfa, getMfaStatus } from "@/lib/api";

/**
 * The real MFA setup/verify flow — closes the critical gap where the
 * backend endpoints existed but no page ever let a real user actually
 * complete them. A user landing here with MFA already enabled sees
 * that immediately rather than being walked through it again.
 */
export default function MfaSetupPage() {
  const t = useTranslations("MfaSetupPage");
  const router = useRouter();

  const [mfaType, setMfaType] = useState<"SMS_OTP" | "EMAIL_OTP">("SMS_OTP");
  const [destination, setDestination] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [alreadyEnabled, setAlreadyEnabled] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    getMfaStatus(token)
      .then((status) => setAlreadyEnabled(status.mfa_enabled))
      .catch(() => {});
  }, [router]);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    try {
      const result = await setupMfa(mfaType, destination, token);
      setChallengeId(result.challenge_id);
    } catch {
      setError(t("setupFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const token = localStorage.getItem("access_token");
    if (!token || !challengeId) return;
    try {
      await verifyMfa(challengeId, code, token);
      setSuccess(true);
    } catch {
      setError(t("verifyFailed"));
    } finally {
      setLoading(false);
    }
  }

  if (alreadyEnabled && !success) {
    return (
      <main className="max-w-sm mx-auto px-4 py-12 text-center">
        <p className="text-green-700 font-semibold mb-4">✓ {t("alreadyEnabled")}</p>
        <button onClick={() => router.push("/list-property")} className="bg-[#1B2A4A] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("continueToListProperty")}
        </button>
      </main>
    );
  }

  if (success) {
    return (
      <main className="max-w-sm mx-auto px-4 py-12 text-center">
        <p className="text-green-700 font-semibold mb-4">✓ {t("success")}</p>
        <button onClick={() => router.push("/list-property")} className="bg-[#1B2A4A] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("continueToListProperty")}
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-sm mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-2">{t("title")}</h1>
      <p className="text-gray-600 text-sm mb-6">{t("subtitle")}</p>

      {!challengeId ? (
        <form onSubmit={handleSendCode} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-gray-700">{t("chooseMethod")}</label>
          <div className="flex rounded overflow-hidden border border-gray-300">
            <label className="flex-1">
              <input type="radio" name="mfaType" checked={mfaType === "SMS_OTP"} onChange={() => setMfaType("SMS_OTP")} className="peer sr-only" />
              <span className="block text-center py-2 text-gray-700 peer-checked:bg-[#1B2A4A] peer-checked:text-white cursor-pointer transition-colors">
                {t("methodSms")}
              </span>
            </label>
            <label className="flex-1">
              <input type="radio" name="mfaType" checked={mfaType === "EMAIL_OTP"} onChange={() => setMfaType("EMAIL_OTP")} className="peer sr-only" />
              <span className="block text-center py-2 text-gray-700 peer-checked:bg-[#1B2A4A] peer-checked:text-white cursor-pointer transition-colors">
                {t("methodEmail")}
              </span>
            </label>
          </div>

          <input
            type={mfaType === "SMS_OTP" ? "tel" : "email"}
            required
            placeholder={mfaType === "SMS_OTP" ? t("phonePlaceholder") : t("emailPlaceholder")}
            className="border rounded px-3 py-2"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button type="submit" disabled={loading} className="bg-[#C9A227] text-[#1B2A4A] font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {loading ? t("sending") : t("sendCode")}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-gray-700">{t("enterCode")}</label>
          <input
            type="text" required maxLength={6} inputMode="numeric"
            placeholder={t("codePlaceholder")}
            className="border rounded px-3 py-2 text-center text-2xl tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button type="submit" disabled={loading} className="bg-[#C9A227] text-[#1B2A4A] font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {loading ? t("verifying") : t("verify")}
          </button>
          <button type="button" onClick={() => setChallengeId(null)} className="text-sm text-gray-500 hover:text-[#1B2A4A]">
            {t("resendCode")}
          </button>
        </form>
      )}
    </main>
  );
}

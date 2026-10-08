"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { requestPasswordReset, confirmPasswordReset } from "@/lib/api";
import Button from "@/components/ui/Button";

/**
 * Forgot-password flow — previously MISSING entirely: request_password_
 * reset()/confirm_password_reset() existed fully at the service layer
 * but had no reachable URL, meaning a real user who forgot their
 * password had no way to actually recover their account.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations("ForgotPasswordPage");
  const router = useRouter();
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("submitting");
    try {
      await requestPasswordReset(username);
      setMessage(t("requestSent"));
      setStep("confirm");
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("requestFailed"));
      setStatus("error");
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("submitting");
    try {
      await confirmPasswordReset(token, newPassword);
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("confirmFailed"));
      setStatus("error");
    }
  }

  return (
    <main className="max-w-md mx-auto px-4 py-16">
      <h1 className="text-2xl font-bold text-[var(--navy)] mb-2 text-center">{t("title")}</h1>
      <p className="text-sm text-gray-500 mb-8 text-center">{t("subtitle")}</p>

      {step === "request" ? (
        <form onSubmit={handleRequest} className="border border-gray-200 rounded-xl p-5 bg-white flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("username")}</label>
            <input required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          {status === "error" && <p className="text-red-600 text-xs">{error}</p>}
          <Button disabled={status === "submitting"}>{status === "submitting" ? t("submitting") : t("requestButton")}</Button>
        </form>
      ) : (
        <form onSubmit={handleConfirm} className="border border-gray-200 rounded-xl p-5 bg-white flex flex-col gap-3">
          {message && <p className="text-emerald-600 text-xs">{message}</p>}
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("resetToken")}</label>
            <input required value={token} onChange={(e) => setToken(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("newPassword")}</label>
            <input required type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          {status === "error" && <p className="text-red-600 text-xs">{error}</p>}
          <Button disabled={status === "submitting"}>{status === "submitting" ? t("submitting") : t("confirmButton")}</Button>
        </form>
      )}

      <p className="text-center text-xs text-gray-500 mt-6">
        <Link href="/login" className="underline">{t("backToLogin")}</Link>
      </p>
    </main>
  );
}

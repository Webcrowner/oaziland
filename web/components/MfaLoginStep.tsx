"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { completeMfaLogin, type MfaRequiredError } from "@/lib/api";
import Button from "@/components/ui/Button";

/** The second sign-in step: the code that was sent to the person's phone or email after the password was accepted. */
export default function MfaLoginStep({ challenge, onTokens, onBack }: {
  challenge: MfaRequiredError;
  onTokens: (tokens: { access: string; refresh: string }) => Promise<void> | void;
  onBack: () => void;
}) {
  const t = useTranslations("MfaLoginStep");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onTokens(await completeMfaLogin(challenge.challengeId, code));
    } catch {
      setError(t("wrongCode"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-bold text-slate-900">{t("title")}</h2>
      <p className="text-sm text-slate-600">{t("sentTo", { destination: challenge.destinationHint })}</p>
      <div>
        <label htmlFor="mfa-login-code" className="block text-sm font-semibold text-slate-700 mb-1.5">{t("codeLabel")}</label>
        <input
          id="mfa-login-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          className="min-h-11 w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-center text-xl tracking-[0.5em] font-semibold text-slate-800 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      {error && (
        <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-medium">{error}</div>
      )}
      <Button disabled={busy || code.length < 6} className="w-full py-3 rounded-xl text-sm font-bold">
        {busy ? t("verifying") : t("verify")}
      </Button>
      <button type="button" onClick={onBack} className="block mx-auto min-h-11 text-xs font-semibold text-amber-600 hover:text-amber-700">
        {t("back")}
      </button>
    </form>
  );
}

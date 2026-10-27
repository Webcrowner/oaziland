"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { getMyCreatorPremiumStatus, subscribeCreatorPremium, cancelCreatorPremium } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import Button from "@/components/ui/Button";

export default function PremiumPage() {
  const t = useTranslations("PremiumPage");
  const [isPremium, setIsPremium] = useState(false);
  const [loggedIn, setLoggedIn] = useState(true);
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "subscribing">("idle");
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      void Promise.resolve().then(() => setLoggedIn(false));
      return;
    }
    getMyCreatorPremiumStatus(token).then((data) => setIsPremium(data.is_premium)).catch(() => {});
  }, []);

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setStatus("subscribing");
    setError("");
    try {
      await subscribeCreatorPremium(phone, token);
      setIsPremium(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription failed");
    } finally {
      setStatus("idle");
    }
  }

  async function handleCancel() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await cancelCreatorPremium(token);
      setCancelled(true);
    } catch {
      setError(t("cancelFailed"));
    }
  }

  if (!loggedIn) {
    return (
      <AccountSidebarLayout activeHref="/premium">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  return (
    <AccountSidebarLayout activeHref="/premium">
      <div className="max-w-md mx-auto text-center">
      <h1 className="text-2xl font-bold text-[var(--navy)] mb-2">{t("title")}</h1>
      <p className="text-gray-600 mb-1">{t("subtitle")}</p>
      <p className="text-3xl font-bold text-[var(--gold)] mb-6">{t("priceLabel")}</p>

      <ul className="text-left text-sm text-gray-700 flex flex-col gap-2 mb-8 max-w-xs mx-auto">
        <li>✓ {t("benefit1")}</li>
        <li>✓ {t("benefit2")}</li>
        <li>✓ {t("benefit3")}</li>
      </ul>

      {isPremium ? (
        <>
          <p className="text-green-700 font-semibold mb-4">✓ {t("alreadySubscribed")}</p>
          {cancelled ? (
            <p className="text-sm text-gray-600">{t("cancelConfirmed")}</p>
          ) : (
            <button onClick={handleCancel} className="text-sm text-red-600 underline">{t("cancel")}</button>
          )}
          {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        </>
      ) : (
        <form onSubmit={handleSubscribe} className="flex flex-col gap-3">
          <input
            type="tel" required placeholder={t("phonePlaceholder")} value={phone}
            onChange={(e) => setPhone(e.target.value)} className="border rounded px-3 py-2"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={status === "subscribing"} className="bg-[var(--gold)] text-[var(--navy)] font-semibold py-3 rounded hover:opacity-90 disabled:opacity-50">
            {status === "subscribing" ? t("subscribing") : t("subscribe")}
          </button>
        </form>
      )}
      </div>
    </AccountSidebarLayout>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyPresenceSettings, updateMyPresenceSettings, type PresenceSettings } from "@/lib/api";

/**
 * A real toggle for the founder's explicit request: "except you off
 * it or hide it." Both online-status and typing-indicator visibility
 * live together here since they're the same kind of choice (what
 * presence signals other people see about you).
 */
export default function PrivacySettingsPage() {
  const t = useTranslations("PrivacySettingsPage");
  const [settings, setSettings] = useState<PresenceSettings | null>(null);
  const [loggedIn, setLoggedIn] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setLoggedIn(false);
      return;
    }
    getMyPresenceSettings(token).then(setSettings).catch(() => {});
  }, []);

  async function handleToggle(field: keyof PresenceSettings) {
    const token = localStorage.getItem("access_token");
    if (!token || !settings) return;
    const updated = { ...settings, [field]: !settings[field] };
    setSettings(updated);
    await updateMyPresenceSettings({ [field]: updated[field] }, token);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!loggedIn) {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Link href="/login" className="inline-block bg-[var(--navy)] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("signInRequired")}
        </Link>
      </main>
    );
  }

  if (!settings) {
    return <main className="max-w-md mx-auto px-4 py-16 text-center text-gray-400">...</main>;
  }

  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-[var(--navy)] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-8 text-sm">{t("subtitle")}</p>

      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4 border rounded-lg p-4 bg-white">
          <div>
            <p className="font-semibold text-[var(--navy)] text-sm">{t("onlineStatusLabel")}</p>
            <p className="text-xs text-gray-500 mt-1">{t("onlineStatusDescription")}</p>
          </div>
          <button
            onClick={() => handleToggle("show_online_status")}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${settings.show_online_status ? "bg-[var(--gold)]" : "bg-gray-300"}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.show_online_status ? "translate-x-6" : "translate-x-0.5"}`} />
          </button>
        </div>

        <div className="flex items-start justify-between gap-4 border rounded-lg p-4 bg-white">
          <div>
            <p className="font-semibold text-[var(--navy)] text-sm">{t("typingIndicatorLabel")}</p>
            <p className="text-xs text-gray-500 mt-1">{t("typingIndicatorDescription")}</p>
          </div>
          <button
            onClick={() => handleToggle("show_typing_indicator")}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${settings.show_typing_indicator ? "bg-[var(--gold)]" : "bg-gray-300"}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.show_typing_indicator ? "translate-x-6" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      {saved && <p className="text-green-700 text-sm mt-4 text-center">✓ {t("saved")}</p>}
    </main>
  );
}

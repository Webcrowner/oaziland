"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import Avatar from "@/components/Avatar";
import { IconEye, IconEyeOff, IconMessageCircle, IconCheckCircle } from "@/components/Icons";
import {
  getMyPresenceSettings,
  updateMyPresenceSettings,
  listBlockedUsers,
  setUserBlocked,
  type PresenceSettings,
  type BlockedUser,
} from "@/lib/api";

type ToggleIcon = React.ComponentType<{ size?: number; className?: string }>;

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
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);

  async function handleUnblock(userId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await setUserBlocked(userId, false, token);
    setBlocked((prev) => prev.filter((u) => u.id !== userId));
  }

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      void Promise.resolve().then(() => setLoggedIn(false));
      return;
    }
    getMyPresenceSettings(token).then(setSettings).catch(() => {});
    listBlockedUsers(token).then((data) => setBlocked(data.results)).catch(() => {});
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
      <AccountSidebarLayout activeHref="/privacy-settings">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Link href="/login" className="inline-block bg-[var(--navy)] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
            {t("signInRequired")}
          </Link>
        </div>
      </AccountSidebarLayout>
    );
  }

  if (!settings) {
    return (
      <AccountSidebarLayout activeHref="/privacy-settings">
        <div className="space-y-4">
          <div className="h-32 rounded-3xl bg-slate-100 animate-pulse" />
          <div className="h-48 rounded-3xl bg-slate-100 animate-pulse" />
        </div>
      </AccountSidebarLayout>
    );
  }

  const toggles: { field: keyof PresenceSettings; label: string; description: string; icon: ToggleIcon }[] = [
    { field: "show_online_status", label: t("onlineStatusLabel"), description: t("onlineStatusDescription"), icon: IconEye },
    { field: "show_typing_indicator", label: t("typingIndicatorLabel"), description: t("typingIndicatorDescription"), icon: IconMessageCircle },
  ];

  return (
    <AccountSidebarLayout activeHref="/privacy-settings">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative p-6 sm:p-8 flex items-center gap-5">
          <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
            <IconEyeOff size={28} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
          </div>
          {saved && (
            <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-3 py-1 text-xs font-bold text-emerald-300">
              <IconCheckCircle size={14} /> {t("saved")}
            </span>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
          <h2 className="text-base font-black tracking-tight text-slate-900 mb-4">{t("activityVisibility")}</h2>
          <ul className="divide-y divide-slate-100">
            {toggles.map(({ field, label, description, icon: Icon }) => {
              const on = settings[field];
              return (
                <li key={field} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-amber-300">
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900">{label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{description}</p>
                  </div>
                  <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={label}
                      onClick={() => handleToggle(field)}
                      style={{ backgroundColor: on ? "#10b981" : "#cbd5e1", borderColor: on ? "#059669" : "#94a3b8" }}
                      className="relative h-7 w-12 rounded-full border-2 transition-colors cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400/40"
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md ring-1 ring-black/10 transition-all ${on ? "left-[22px]" : "left-0.5"}`}
                      />
                    </button>
                    <span className={`text-[10px] font-black uppercase tracking-wider ${on ? "text-emerald-600" : "text-slate-400"}`}>
                      {on ? "On" : "Off"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {saved && (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 sm:hidden">
              <IconCheckCircle size={16} /> {t("saved")}
            </p>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h2 className="text-base font-black tracking-tight text-slate-900">{t("blockedUsersTitle")}</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{blocked.length}</span>
          </div>
          <p className="text-sm text-slate-500 mb-4">{t("blockedUsersDescription")}</p>
          {blocked.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-8 text-center text-sm text-slate-500">
              {t("blockedUsersEmpty")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {blocked.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-3">
                  <Avatar
                    src={u.profile_image_url}
                    name={u.full_name}
                    className="w-10 h-10 rounded-xl bg-slate-900 text-amber-300 text-sm font-bold"
                  />
                  <span className="flex-1 min-w-0 truncate text-sm font-bold text-slate-800">{u.full_name}</span>
                  <button
                    type="button"
                    onClick={() => handleUnblock(u.id)}
                    className="text-xs font-bold px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    {t("unblock")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AccountSidebarLayout>
  );
}

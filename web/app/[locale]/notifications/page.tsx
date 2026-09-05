"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listMyNotifications, markNotificationRead, markAllNotificationsRead, type AppNotification } from "@/lib/api";

export default function NotificationsPage() {
  const t = useTranslations("NotificationsPage");
  const locale = useLocale();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    listMyNotifications(token)
      .then((data) => {
        setNotifications(data.results);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleMarkRead(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await markNotificationRead(id, token);
    load();
  }

  async function handleMarkAllRead() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await markAllNotificationsRead(token);
    load();
  }

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Link href="/login" className="inline-block bg-[#1B2A4A] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("signInRequired")}
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-[#1B2A4A]">{t("title")}</h1>
        {notifications.some((n) => !n.read_at) && (
          <button onClick={handleMarkAllRead} className="text-sm text-[#1B2A4A] underline">{t("markAllRead")}</button>
        )}
      </div>

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : notifications.length === 0 ? (
        <p className="text-gray-500">{t("noNotificationsYet")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleMarkRead(n.id)}
              className={`text-left border rounded-lg p-4 transition-colors ${n.read_at ? "bg-white" : "bg-[#C9A227]/10 border-[#C9A227]"}`}
            >
              <p className="font-semibold text-[#1B2A4A] text-sm">{n.title}</p>
              <p className="text-sm text-gray-600 mt-1">{n.message}</p>
              <p className="text-xs text-gray-400 mt-2">{new Date(n.created_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-US")}</p>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

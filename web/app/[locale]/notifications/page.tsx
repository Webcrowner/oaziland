"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { listMyNotifications, markNotificationRead, markAllNotificationsRead, type AppNotification } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";

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
    void Promise.resolve().then(() => load());
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
      <AccountSidebarLayout activeHref="/notifications">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  return (
    <AccountSidebarLayout activeHref="/notifications">
      <PageHeader
        title={t("title")}
        action={notifications.some((n) => !n.read_at) ? (
          <button onClick={handleMarkAllRead} className="text-sm text-[var(--navy)] underline">{t("markAllRead")}</button>
        ) : undefined}
      />

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : notifications.length === 0 ? (
        <EmptyState icon="🔔" title={t("noNotificationsYet")} />
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleMarkRead(n.id)}
              className={`text-left border rounded-lg p-4 transition-colors ${n.read_at ? "bg-white" : "bg-[var(--gold)]/10 border-[var(--gold)]"}`}
            >
              <p className="font-semibold text-[var(--navy)] text-sm">{n.title}</p>
              <p className="text-sm text-gray-600 mt-1">{n.message}</p>
              <p className="text-xs text-gray-400 mt-2">{new Date(n.created_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-US")}</p>
            </button>
          ))}
        </div>
      )}
    </AccountSidebarLayout>
  );
}

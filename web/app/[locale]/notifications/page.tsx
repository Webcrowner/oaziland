"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { listMyNotifications, markNotificationRead, markAllNotificationsRead, type AppNotification } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { IconBell, IconCheckCircle, IconChevronRight } from "@/components/Icons";
import { Link } from "@/i18n/navigation";
import { notificationHref } from "@/lib/notificationLinks";
import PushToggle from "@/components/PushToggle";

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

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <AccountSidebarLayout activeHref="/notifications">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4 p-6 sm:p-8">
          <div className="flex items-center gap-5 min-w-0">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
              <IconBell size={28} />
              {unreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-slate-900 bg-white px-1 text-[11px] font-black text-slate-900">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("title")}</h1>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/20"
            >
              <IconCheckCircle size={16} />
              {t("markAllRead")}
            </button>
          )}
        </div>
      </section>

      <div className="mb-6">
        <PushToggle />
      </div>

      {status === "loading" ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState icon={<IconBell size={28} />} title={t("noNotificationsYet")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {notifications.map((n) => {
            const unread = !n.read_at;
            const href = notificationHref(n.target);
            const cardClass = `group flex w-full min-h-[44px] items-start gap-4 rounded-2xl border p-4 sm:p-5 text-left shadow-sm transition-all ${
              unread
                ? "border-amber-200 bg-amber-50/60 hover:border-amber-300 hover:shadow-md"
                : href
                  ? "border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-md"
                  : "cursor-default border-slate-200/90 bg-white"
            }`;
            const body = (
              <>
                  <span
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      unread ? "bg-slate-900 text-amber-300" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    <IconBell size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className={`text-sm text-slate-900 ${unread ? "font-black" : "font-bold"}`}>{n.title}</span>
                      {unread && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-slate-600">{n.message}</span>
                    <time dateTime={n.created_at} className="mt-2 block text-xs font-semibold text-slate-400">
                      {new Date(n.created_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </time>
                  </span>
                  {href && (
                    <span className="mt-2.5 flex shrink-0 items-center gap-0.5 text-xs font-bold text-slate-500 group-hover:text-slate-900">
                      <span className="hidden sm:inline">{t("open")}</span>
                      <IconChevronRight size={16} />
                    </span>
                  )}
              </>
            );
            return (
              <li key={n.id}>
                {href ? (
                  <Link
                    href={href}
                    onClick={() => {
                      if (unread) void markNotificationRead(n.id, localStorage.getItem("access_token") ?? "");
                    }}
                    aria-label={`${t("open")}: ${n.title}`}
                    className={cardClass}
                  >
                    {body}
                  </Link>
                ) : (
                  <button type="button" onClick={() => unread && handleMarkRead(n.id)} className={cardClass}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AccountSidebarLayout>
  );
}

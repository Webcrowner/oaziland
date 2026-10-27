"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyGuestHouseHostDashboard, getMyProfile, type GuestHouseHostDashboard } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import StatCard from "@/components/ui/StatCard";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import {
  IconShare, IconQrCode, IconArrowUpRight, IconHome, IconClock, IconCheckCircle, IconSparkles,
} from "@/components/Icons";

/**
 * The real Guest House Host dashboard — aggregates across every guest
 * house a host owns, from get_host_dashboard_summary() (already
 * built, tested, and now finally reachable).
 */
export default function HostDashboardPage() {
  const t = useTranslations("HostDashboardPage");
  const [data, setData] = useState<GuestHouseHostDashboard | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [userId, setUserId] = useState<string>("");
  const [showShareModal, setShowShareModal] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      void Promise.resolve().then(() => setStatus("signedOut"));
      return;
    }
    Promise.all([getMyProfile(token), getMyGuestHouseHostDashboard(token)])
      .then(([profile, result]) => {
        setUserId(profile.id);
        setData(result);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  if (status === "signedOut") {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/host-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading" || !data) {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/host-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      </DashboardLayout>
    );
  }

  if (data.total_guest_houses === 0) {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/host-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <Panel>
          <EmptyState title={t("noGuestHouses")} action={<Button href="/guest-houses">{t("listAGuestHouse")}</Button>} />
        </Panel>
      </DashboardLayout>
    );
  }

  const trend = data.booked_nights_trend;
  const shareUrl = typeof window !== "undefined" && userId ? `${window.location.origin}/user/${userId}` : "";

  return (
    <DashboardLayout
      currentRole="landlord"
      activeHref="/host-dashboard"
      title={t("title")}
      subtitle={t("subtitle")}
      action={
        userId ? (
          <div className="flex items-center gap-2">
            <Link
              href={`/user/${userId}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <span>Public Index</span>
              <IconArrowUpRight size={14} />
            </Link>
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-amber-300 hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
            >
              <IconQrCode size={15} />
              <IconShare size={14} />
              <span>Share & QR</span>
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon={IconHome} label={t("totalGuestHouses")} value={data.total_guest_houses} />
        <StatCard icon={IconClock} tone="indigo" label={t("blockedNights")} value={data.total_blocked_nights_all_channels} />
        <StatCard icon={IconCheckCircle} tone="amber" label={t("pendingHousekeeping")} value={data.pending_housekeeping_tasks} />
      </div>

      <StatCard
        icon={IconSparkles}
        tone={trend.percent_change === null ? "default" : trend.percent_change >= 0 ? "emerald" : "rose"}
        label={t("bookedNightsTrend")}
        value={trend.percent_change === null ? "—" : `${trend.percent_change > 0 ? "+" : ""}${trend.percent_change}%`}
        hint={trend.percent_change === null ? t("noHistoryYet") : t("vsLastPeriod")}
      />

      {userId && (
        <ShareAndQrModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          url={shareUrl}
          title="My Guest House & Lodge Portfolio"
          subtitle="Share your guest houses and auberges page and QR code with guests and tourists."
        />
      )}
    </DashboardLayout>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyLandlordPortfolio, getMyProfile, type LandlordPortfolio } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import StatCard from "@/components/ui/StatCard";
import WalletPayoutCard from "@/components/WalletPayoutCard";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import {
  IconChevronRight, IconShare, IconQrCode, IconArrowUpRight,
  IconBuilding, IconCheckCircle, IconFileText, IconCreditCard, IconSparkles,
} from "@/components/Icons";

export default function LandlordPortfolioPage() {
  const t = useTranslations("LandlordPortfolioPage");
  const [data, setData] = useState<LandlordPortfolio | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [userId, setUserId] = useState<string>("");
  const [showShareModal, setShowShareModal] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([getMyProfile(token), getMyLandlordPortfolio(token)])
      .then(([profile, result]) => {
        setUserId(profile.id);
        setData(result);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  if (status === "signedOut") {
    return (
      <DashboardLayout
        currentRole="landlord"
        activeHref="/landlord-portfolio"
        title={t("title")}
        subtitle={t("subtitle")}
      >
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4 font-semibold text-sm">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading" || !data) {
    return (
      <DashboardLayout
        currentRole="landlord"
        activeHref="/landlord-portfolio"
        title={t("title")}
        subtitle={t("subtitle")}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
            ))}
          </div>
          <div className="h-48 rounded-3xl bg-slate-100 animate-pulse" />
        </div>
      </DashboardLayout>
    );
  }

  if (data.total_properties === 0) {
    return (
      <DashboardLayout
        currentRole="landlord"
        activeHref="/landlord-portfolio"
        title={t("title")}
        subtitle={t("subtitle")}
      >
        <Panel>
          <EmptyState title={t("noProperties")} action={<Button href="/list-property">{t("listAProperty")}</Button>} />
        </Panel>
      </DashboardLayout>
    );
  }

  const trend = data.bookings_trend;
  const shareUrl = typeof window !== "undefined" && userId ? `${window.location.origin}/user/${userId}` : "";

  return (
    <DashboardLayout
      currentRole="landlord"
      activeHref="/landlord-portfolio"
      title={t("title")}
      subtitle={t("subtitle")}
      badge="Property Owner"
      action={
        <div className="flex items-center gap-2">
          {userId && (
            <>
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
            </>
          )}
          <Link
            href="/list-property"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
          >
            <span>{t("listAProperty")}</span>
            <IconChevronRight size={14} />
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={IconBuilding}
            label={t("totalProperties")}
            value={data.total_properties}
            hint="Managed across all quarters"
          />
          <StatCard
            icon={IconCheckCircle}
            tone="emerald"
            label={t("publishedListings")}
            value={data.published_listings}
            hint={`${t("totalListings")}: ${data.total_listings}`}
          />
          <StatCard
            icon={IconFileText}
            tone="indigo"
            label={t("completedBookings")}
            value={data.completed_bookings}
            hint="Tenant bookings fulfilled"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            icon={IconCreditCard}
            tone="amber"
            label={t("totalCommissionPaid")}
            value={Number(data.total_commission_paid_xaf).toLocaleString()}
            unit="XAF"
            hint="Platform service fees settled"
          />
          <StatCard
            icon={IconSparkles}
            tone={trend.percent_change === null ? "default" : trend.percent_change >= 0 ? "emerald" : "rose"}
            label={t("bookingsTrend")}
            value={
              trend.percent_change === null
                ? "—"
                : `${trend.percent_change > 0 ? "+" : ""}${trend.percent_change}%`
            }
            hint={
              trend.percent_change === null
                ? t("noHistoryYet")
                : `${t("vsLastPeriod")} · Current: ${trend.current_period_value} | Previous: ${trend.previous_period_value}`
            }
          />
        </div>

        {/* Real Mobile Money Payout & Withdrawal Module */}
        <WalletPayoutCard
          title="Rental Earnings & Mobile Money Payouts"
          subtitle="Instant cash-out of cleared tenant escrow releases to your MTN MoMo or Orange Money."
        />
      </div>

      {userId && (
        <ShareAndQrModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          url={shareUrl}
          title="My Property Portfolio"
          subtitle="Share your verified properties, apartments, and listings with clients and seekers."
        />
      )}
    </DashboardLayout>
  );
}

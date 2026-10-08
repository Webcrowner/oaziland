"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyProfile, listMyVenues, getVenueFinancialDashboard, type Venue, type VenueFinancialDashboard } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import StatCard from "@/components/ui/StatCard";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import { IconShare, IconQrCode, IconArrowUpRight, IconFileText, IconCreditCard, IconSparkles } from "@/components/Icons";

/**
 * The real Venue Owner financial dashboard — revenue/bookings trends,
 * outstanding balances, escrow status, and top event types by
 * revenue, from get_venue_financial_dashboard() (already built,
 * tested, and now finally reachable). A venue owner may own more than
 * one venue, so this page lists their own venues first and shows the
 * financial dashboard for whichever one is selected.
 */
export default function VenueDashboardPage() {
  const t = useTranslations("VenueDashboardPage");
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [userId, setUserId] = useState<string>("");
  const [myVenues, setMyVenues] = useState<Venue[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const [dashboard, setDashboard] = useState<VenueFinancialDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([getMyProfile(token), listMyVenues(token)])
      .then(([profile, venuesData]) => {
        setUserId(profile.id);
        const owned = venuesData.results.filter((v) => v.owner === profile.id);
        setMyVenues(owned);
        if (owned.length > 0) setSelectedVenueId(owned[0].id);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  const loadDashboard = useCallback((venueId: string) => {
    const token = localStorage.getItem("access_token");
    if (!token || !venueId) return;
    setDashboardLoading(true);
    getVenueFinancialDashboard(venueId, token)
      .then((data) => setDashboard(data))
      .catch(() => setDashboard(null))
      .finally(() => setDashboardLoading(false));
  }, []);

  useEffect(() => {
    if (selectedVenueId) loadDashboard(selectedVenueId);
  }, [selectedVenueId, loadDashboard]);

  if (status === "signedOut") {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/venue-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading") {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/venue-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      </DashboardLayout>
    );
  }

  if (myVenues.length === 0) {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/venue-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <Panel>
          <EmptyState title={t("noVenues")} action={<Button href="/events">{t("listAVenue")}</Button>} />
        </Panel>
      </DashboardLayout>
    );
  }

  const shareUrl = typeof window !== "undefined" && userId ? `${window.location.origin}/user/${userId}` : "";

  return (
    <DashboardLayout
      currentRole="landlord"
      activeHref="/venue-dashboard"
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
      {myVenues.length > 1 && (
        <div className="mb-6 max-w-xs">
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{t("selectVenue")}</label>
          <select
            value={selectedVenueId}
            onChange={(e) => setSelectedVenueId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15"
          >
            {myVenues.map((v) => (
              <option key={v.id} value={v.id}>{v.quarter_name}</option>
            ))}
          </select>
        </div>
      )}

      {dashboardLoading || !dashboard ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={IconFileText} label={t("totalBookings")} value={dashboard.total_bookings} />
            <StatCard
              icon={IconCreditCard}
              tone="amber"
              label={t("outstandingBalance")}
              value={Number(dashboard.outstanding_balance_xaf).toLocaleString()}
              unit="XAF"
            />
            <StatCard
              icon={IconSparkles}
              tone={dashboard.revenue_trend_xaf.percent_change === null ? "default" : dashboard.revenue_trend_xaf.percent_change >= 0 ? "emerald" : "rose"}
              label={t("revenueTrend")}
              value={
                dashboard.revenue_trend_xaf.percent_change === null
                  ? "—"
                  : `${dashboard.revenue_trend_xaf.percent_change > 0 ? "+" : ""}${dashboard.revenue_trend_xaf.percent_change}%`
              }
              hint={dashboard.revenue_trend_xaf.percent_change === null ? t("noHistoryYet") : t("vsLastPeriod")}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <Panel title={t("topEventTypes")}>
              {dashboard.top_event_types_by_revenue.length === 0 ? (
                <p className="text-sm text-slate-400">{t("noHistoryYet")}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {dashboard.top_event_types_by_revenue.map((row) => (
                    <li key={row.group} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="font-semibold text-slate-700">{row.group}</span>
                      <span className="font-black text-slate-900">{Number(row.total).toLocaleString()} XAF</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t("escrowStatus")}>
              {Object.keys(dashboard.escrow_status_breakdown).length === 0 ? (
                <p className="text-sm text-slate-400">{t("noHistoryYet")}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {Object.entries(dashboard.escrow_status_breakdown).map(([escrowStatus, count]) => (
                    <li key={escrowStatus} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="font-semibold text-slate-700">{escrowStatus.replace(/_/g, " ")}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-black text-slate-700">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}

      {userId && (
        <ShareAndQrModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          url={shareUrl}
          title="My Event Venues Portfolio"
          subtitle="Share your event centers, halls, and venue spaces with event planners and celebrants."
        />
      )}
    </DashboardLayout>
  );
}

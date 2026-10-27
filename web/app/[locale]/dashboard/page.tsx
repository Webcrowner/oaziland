"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyAgentDashboard, type AgentDashboard } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import StatCard from "@/components/ui/StatCard";
import { IconChevronRight, IconCheckCircle, IconMessageCircle, IconCreditCard, IconBuilding, IconUsers } from "@/components/Icons";

export default function DashboardPage() {
  const t = useTranslations("AgentDashboardPage");
  const [dashboard, setDashboard] = useState<AgentDashboard | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "notAgent" | "ready">("loading");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      void Promise.resolve().then(() => setStatus("signedOut"));
      return;
    }
    getMyAgentDashboard(token)
      .then((data) => {
        setDashboard(data);
        setStatus("ready");
      })
      .catch(() => setStatus("notAgent"));
  }, []);

  if (status === "signedOut") {
    return (
      <DashboardLayout
        currentRole="agent"
        activeHref="/dashboard"
        title={t("title")}
        subtitle={t("subtitleSignedOut")}
      >
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4 font-semibold text-sm">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "notAgent") {
    return (
      <DashboardLayout
        currentRole="agent"
        activeHref="/dashboard"
        title={t("title")}
        subtitle={t("subtitleSignedOut")}
      >
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4">{t("notAnAgent")}</p>
          <Button href="/how-it-works">{t("learnBecomeAgent")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading" || !dashboard) {
    return (
      <DashboardLayout
        currentRole="agent"
        activeHref="/dashboard"
        title={t("title")}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const trend = dashboard.commission_trend_xaf;

  return (
    <DashboardLayout
      currentRole="agent"
      activeHref="/dashboard"
      title={t("title")}
      subtitle={t("subtitleReady")}
      badge={t("badgeLicensedAgent")}
      action={
        <Link
          href="/agency-dashboard"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
        >
          <span>{t("viewAgencyDashboard")}</span>
          <IconChevronRight size={14} />
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={IconCheckCircle}
            label={t("performanceScore")}
            value={dashboard.performance_score.completed_deals_count}
            unit={t("dealsClosed")}
            hint={
              <>
                {dashboard.performance_score.avg_response_time_minutes === null
                  ? t("noResponseData")
                  : t("avgResponse", { minutes: dashboard.performance_score.avg_response_time_minutes })}
                {" · "}
                {dashboard.performance_score.percent_listings_verified === null
                  ? t("noListingsYet")
                  : t("listingsVerified", { percent: dashboard.performance_score.percent_listings_verified })}
              </>
            }
          />
          <StatCard
            icon={IconMessageCircle}
            tone="amber"
            label={t("openEnquiries")}
            value={dashboard.open_enquiries}
            hint={t("activeEnquiriesHint")}
          />
          <StatCard
            icon={IconCreditCard}
            tone={trend.percent_change !== null && trend.percent_change < 0 ? "rose" : "emerald"}
            label={t("commissionTrend")}
            value={Number(trend.current_period_value).toLocaleString()}
            unit="XAF"
            hint={
              trend.percent_change === null
                ? t("newNoHistory")
                : `${trend.percent_change > 0 ? "+" : ""}${trend.percent_change}% ${t("vsLastPeriod")}`
            }
          />
        </div>

        {dashboard.is_agency_owner && (
          <Panel
            title={t("agencySection")}
            action={<span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">{t("agencyPrincipal")}</span>}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">
                  <IconUsers size={14} /> {t("agencyRoster")}
                </p>
                <ul className="space-y-2">
                  {dashboard.agency_roster?.map((member) => (
                    <li key={member.user__username} className="flex items-center gap-2.5 text-sm font-bold text-slate-800">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-black text-amber-300">
                        {(member.user__username.charAt(0) || "?").toUpperCase()}
                      </span>
                      {member.user__username}
                    </li>
                  ))}
                </ul>
              </div>

              <StatCard
                icon={IconBuilding}
                tone="emerald"
                label={t("agencyCommission")}
                value={Number(dashboard.agency_aggregated_commission_xaf || 0).toLocaleString()}
                unit="XAF"
                hint={t("teamClosingVolume")}
              />
            </div>
          </Panel>
        )}
      </div>
    </DashboardLayout>
  );
}

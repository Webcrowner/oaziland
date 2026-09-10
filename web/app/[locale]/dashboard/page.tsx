"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyAgentDashboard, type AgentDashboard } from "@/lib/api";

/**
 * The private agent/agency dashboard — real leads, commission, and
 * performance data. Reuses the exact same backend aggregation
 * (agency.services.get_agent_private_dashboard) the founder's own
 * account would see, since he's an agent and agency owner himself —
 * this is the "well and professionally made" private space he asked
 * for early in this project, finally with a real page behind it.
 */
export default function DashboardPage() {
  const t = useTranslations("AgentDashboardPage");
  const [dashboard, setDashboard] = useState<AgentDashboard | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "notAgent" | "ready">("loading");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
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
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Link href="/login" className="inline-block bg-[var(--navy)] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("signInRequired")}
        </Link>
      </main>
    );
  }

  if (status === "notAgent") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600">{t("notAnAgent")}</p>
      </main>
    );
  }

  if (status === "loading" || !dashboard) {
    return <main className="max-w-4xl mx-auto px-4 py-16 text-center text-gray-400">...</main>;
  }

  const trend = dashboard.commission_trend_xaf;

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[var(--navy)] mb-8">{t("title")}</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <div className="border rounded-lg p-5 bg-white">
          <p className="text-xs text-gray-500 mb-1">{t("performanceScore")}</p>
          <p className="text-2xl font-bold text-[var(--navy)]">{dashboard.performance_score}</p>
        </div>
        <div className="border rounded-lg p-5 bg-white">
          <p className="text-xs text-gray-500 mb-1">{t("openEnquiries")}</p>
          <p className="text-2xl font-bold text-[var(--navy)]">{dashboard.open_enquiries}</p>
        </div>
        <div className="border rounded-lg p-5 bg-white">
          <p className="text-xs text-gray-500 mb-1">{t("commissionTrend")}</p>
          <p className="text-2xl font-bold text-[var(--navy)]">{Number(trend.current_period_value).toLocaleString()} XAF</p>
          <p className="text-xs text-gray-400 mt-1">
            {trend.percent_change === null ? t("newNoHistory") : `${trend.percent_change > 0 ? "+" : ""}${trend.percent_change}% ${t("vsLastPeriod")}`}
          </p>
        </div>
      </div>

      {dashboard.is_agency_owner && (
        <div>
          <h2 className="text-lg font-semibold text-[var(--navy)] mb-4 border-b pb-2">{t("agencySection")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border rounded-lg p-5 bg-white">
              <p className="text-xs text-gray-500 mb-2">{t("agencyRoster")}</p>
              <ul className="text-sm text-gray-700">
                {dashboard.agency_roster?.map((member) => (
                  <li key={member.user__username}>{member.user__username}</li>
                ))}
              </ul>
            </div>
            <div className="border rounded-lg p-5 bg-white">
              <p className="text-xs text-gray-500 mb-1">{t("agencyCommission")}</p>
              <p className="text-2xl font-bold text-[var(--navy)]">
                {Number(dashboard.agency_aggregated_commission_xaf || 0).toLocaleString()} XAF
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

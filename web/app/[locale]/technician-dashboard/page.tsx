"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { getMyTechnicianDashboard } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";

interface DashboardData {
  active_job_count: number;
  completed_job_count: number;
  wallet_balance_xaf: string;
  jobs_trend: { current_period_value: number; previous_period_value: number; percent_change: number | null };
}

/**
 * The real Technician Dashboard — job counts, wallet balance, and a
 * real period-over-period trend, all from get_technician_dashboard_
 * summary() (already built, tested, and now finally reachable).
 */
export default function TechnicianDashboardPage() {
  const t = useTranslations("TechnicianDashboardPage");
  const [data, setData] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    getMyTechnicianDashboard(token).then((result) => { setData(result); setStatus("ready"); }).catch(() => setStatus("ready"));
  }, []);

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Button href="/login">{t("signInRequired")}</Button>
      </main>
    );
  }

  if (status === "loading" || !data) {
    return <main className="max-w-4xl mx-auto px-4 py-8"><p className="text-gray-400">...</p></main>;
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="border border-gray-200 rounded-xl p-5 bg-white">
          <p className="text-xs text-gray-500 mb-1">{t("activeJobs")}</p>
          <p className="text-2xl font-bold text-[var(--navy)]">{data.active_job_count}</p>
        </div>
        <div className="border border-gray-200 rounded-xl p-5 bg-white">
          <p className="text-xs text-gray-500 mb-1">{t("completedJobs")}</p>
          <p className="text-2xl font-bold text-[var(--navy)]">{data.completed_job_count}</p>
        </div>
        <div className="border border-gray-200 rounded-xl p-5 bg-white">
          <p className="text-xs text-gray-500 mb-1">{t("walletBalance")}</p>
          <p className="text-2xl font-bold text-[var(--navy)]">{Number(data.wallet_balance_xaf).toLocaleString()} XAF</p>
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl p-5 bg-white">
        <p className="text-xs text-gray-500 mb-1">{t("jobsTrend")}</p>
        <p className="text-sm text-gray-700">
          {data.jobs_trend.percent_change === null
            ? t("noHistoryYet")
            : `${data.jobs_trend.percent_change > 0 ? "+" : ""}${data.jobs_trend.percent_change}% ${t("vsLastPeriod")}`}
        </p>
      </div>
    </main>
  );
}

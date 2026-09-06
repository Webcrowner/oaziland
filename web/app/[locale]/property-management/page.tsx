"use client";
import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listMaintenanceRequests, addMaintenanceCost, closeMaintenanceRequest,
  listTenantScreenings, consentToScreening, generateScreeningReport,
  listSafetyCheckIns, startSafetyCheckIn, checkOutSafely,
  type MaintenanceRequestItem, type TenantScreeningItem, type SafetyCheckInItem,
} from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

type Tab = "maintenance" | "screening" | "safety";

/**
 * Property Management — a real gap this closes: maintenance tracking,
 * tenant screening, and agent safety check-ins all had real, working
 * backend logic with zero way to reach any of it. Same tabbed pattern
 * as the Admin Console, built on the shared UI foundation
 * (PageHeader, EmptyState, Badge, Button) from earlier this session.
 */
export default function PropertyManagementPage() {
  const t = useTranslations("PropertyManagementPage");
  const [tab, setTab] = useState<Tab>("maintenance");
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequestItem[]>([]);
  const [screenings, setScreenings] = useState<TenantScreeningItem[]>([]);
  const [checkIns, setCheckIns] = useState<SafetyCheckInItem[]>([]);

  const loadAll = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([listMaintenanceRequests(token), listTenantScreenings(token), listSafetyCheckIns(token)])
      .then(([maintenanceData, screeningData, checkInData]) => {
        setMaintenanceRequests(maintenanceData.results);
        setScreenings(screeningData.results);
        setCheckIns(checkInData.results);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleCloseMaintenance(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await closeMaintenanceRequest(id, token);
    loadAll();
  }

  async function handleConsent(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await consentToScreening(id, token);
    loadAll();
  }

  async function handleGenerateReport(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await generateScreeningReport(id, token);
    loadAll();
  }

  async function handleCheckOut(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await checkOutSafely(id, token);
    loadAll();
  }

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Button href="/login">{t("signInRequired")}</Button>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="flex gap-2 mb-8 flex-wrap">
        {(["maintenance", "screening", "safety"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === key ? "bg-[var(--navy)] text-white" : "bg-gray-100 text-gray-700"}`}
          >
            {t(`tab_${key}`)}
          </button>
        ))}
      </div>

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : tab === "maintenance" ? (
        maintenanceRequests.length === 0 ? (
          <EmptyState icon="🔧" title={t("noMaintenanceYet")} />
        ) : (
          <div className="flex flex-col gap-3">
            {maintenanceRequests.map((request) => (
              <div key={request.id} className="border border-gray-200 rounded-xl p-4 bg-white">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Badge variant={request.category === "EMERGENCY" ? "clay" : "neutral"}>{request.category}</Badge>
                  <Badge variant={request.status === "CLOSED" ? "green" : "gold"}>{request.status}</Badge>
                </div>
                <p className="text-sm text-gray-700 mb-2">{request.description}</p>
                {request.cost_estimate_xaf && (
                  <p className="text-sm font-semibold text-[var(--navy)] mb-2">{t("totalCost")}: {Number(request.cost_estimate_xaf).toLocaleString()} XAF</p>
                )}
                {request.status !== "CLOSED" && (
                  <button onClick={() => handleCloseMaintenance(request.id)} className="text-xs text-[var(--navy)] underline">
                    {t("markClosed")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === "screening" ? (
        screenings.length === 0 ? (
          <EmptyState icon="📋" title={t("noScreeningsYet")} />
        ) : (
          <div className="flex flex-col gap-3">
            {screenings.map((screening) => (
              <div key={screening.id} className="border border-gray-200 rounded-xl p-4 bg-white">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold text-[var(--navy)]">{screening.prospective_tenant_name}</p>
                  <Badge variant={screening.status === "COMPLETED" ? "green" : "gold"}>{screening.status}</Badge>
                </div>
                {screening.report_summary && (
                  <div className="text-xs text-gray-600 mb-2">
                    <p>{t("completedBookings")}: {screening.report_summary.completed_bookings}</p>
                    <p>{t("warnings")}: {screening.report_summary.warning_count}</p>
                  </div>
                )}
                {screening.status === "PENDING_CONSENT" && (
                  <button onClick={() => handleConsent(screening.id)} className="text-xs text-[var(--navy)] underline mr-4">
                    {t("grantConsent")}
                  </button>
                )}
                {screening.status === "CONSENTED" && (
                  <button onClick={() => handleGenerateReport(screening.id)} className="text-xs text-[var(--navy)] underline">
                    {t("generateReport")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : checkIns.length === 0 ? (
        <EmptyState icon="🦺" title={t("noCheckInsYet")} />
      ) : (
        <div className="flex flex-col gap-3">
          {checkIns.map((checkIn) => (
            <div key={checkIn.id} className="border border-gray-200 rounded-xl p-4 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-[var(--navy)]">{checkIn.emergency_contact_name}</p>
                <Badge variant={checkIn.status === "ACTIVE" ? "gold" : checkIn.status === "ALERT_TRIGGERED" ? "clay" : "green"}>{checkIn.status}</Badge>
              </div>
              <p className="text-xs text-gray-500 mb-2">{t("expectedBy")}: {new Date(checkIn.expected_checkout_at).toLocaleString()}</p>
              {checkIn.status === "ACTIVE" && (
                <button onClick={() => handleCheckOut(checkIn.id)} className="text-xs text-[var(--navy)] underline">
                  {t("checkOutNow")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

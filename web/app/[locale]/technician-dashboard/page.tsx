"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  getMyTechnicianDashboard, submitTechnicianLocationPing, getMyTechnicianAvailability, setMyTechnicianAvailability,
  listFacilityContracts, logFacilityVisit, listProjectCases, completeProjectMilestone, getMyProfile,
  type TechnicianDashboardData, type TechnicianAvailabilitySlotItem, type FacilityContractItem, type ProjectCaseItem,
} from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import WalletPayoutCard from "@/components/WalletPayoutCard";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import { IconChevronRight, IconShare, IconQrCode, IconArrowUpRight } from "@/components/Icons";
import { useTasklnLabels } from "@/lib/useTasklnLabels";

// 2024-01-01 is a Monday, matching the backend's 0=Monday day_of_week.
const dayLabel = (locale: string, index: number) => new Date(2024, 0, 1 + index).toLocaleDateString(locale, { weekday: "short" });

export default function TechnicianDashboardPage() {
  const t = useTranslations("TechnicianDashboardPage");
  const labels = useTasklnLabels();
  const locale = useLocale();
  const [data, setData] = useState<TechnicianDashboardData | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [availableDays, setAvailableDays] = useState<Set<number>>(new Set());
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [locationStatus, setLocationStatus] = useState<"idle" | "sharing" | "shared" | "error">("idle");
  const [facilityContracts, setFacilityContracts] = useState<FacilityContractItem[]>([]);
  const [projectCases, setProjectCases] = useState<ProjectCaseItem[]>([]);
  const [visitNotes, setVisitNotes] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string>("");
  const [showShareModal, setShowShareModal] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([
      getMyTechnicianDashboard(token),
      getMyTechnicianAvailability(token),
      listFacilityContracts(token),
      listProjectCases(token),
      getMyProfile(token),
    ])
      .then(([result, slots, facilityData, projectData, profile]) => {
        setData(result);
        setUserId(profile.id);
        setAvailableDays(new Set(slots.map((s) => s.day_of_week)));
        setFacilityContracts(facilityData.results);
        setProjectCases(projectData.results);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleLogVisit(contractId: string) {
    const token = localStorage.getItem("access_token");
    const notes = visitNotes[contractId];
    if (!token || !notes) return;
    await logFacilityVisit(contractId, notes, token);
    setVisitNotes((prev) => ({ ...prev, [contractId]: "" }));
    load();
  }

  async function handleCompleteMilestone(caseId: string, milestoneId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await completeProjectMilestone(caseId, milestoneId, token);
    load();
  }

  function toggleDay(day: number) {
    setAvailableDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function handleSaveAvailability() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setSavingAvailability(true);
    try {
      const slots: TechnicianAvailabilitySlotItem[] = Array.from(availableDays).map((day) => ({
        day_of_week: day, start_time: "00:00:00", end_time: "23:59:00",
      }));
      await setMyTechnicianAvailability(slots, token);
    } finally {
      setSavingAvailability(false);
    }
  }

  function handleShareLocation() {
    const token = localStorage.getItem("access_token");
    if (!token || !navigator.geolocation) return;
    setLocationStatus("sharing");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await submitTechnicianLocationPing(position.coords.latitude, position.coords.longitude, token);
          setLocationStatus("shared");
        } catch {
          setLocationStatus("error");
        }
      },
      () => setLocationStatus("error"),
    );
  }

  if (status === "signedOut") {
    return (
      <DashboardLayout
        currentRole="technician"
        activeHref="/technician-dashboard"
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
        currentRole="technician"
        activeHref="/technician-dashboard"
        title={t("title")}
        subtitle={t("subtitle")}
      >
        <div className="text-center py-20 text-slate-400">{t("loading")}</div>
      </DashboardLayout>
    );
  }

  const shareUrl = typeof window !== "undefined" && userId ? `${window.location.origin}/user/${userId}` : "";

  return (
    <DashboardLayout
      currentRole="technician"
      activeHref="/technician-dashboard"
      title={t("title")}
      subtitle={t("subtitle")}
      badge={t("badgeVetted")}
      action={
        <div className="flex items-center gap-2">
          {userId && (
            <>
              <Link
                href={`/user/${userId}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors shadow-2xs"
              >
                <span>{t("publicProfile")}</span>
                <IconArrowUpRight size={14} />
              </Link>
              <button
                type="button"
                onClick={() => setShowShareModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-amber-300 hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
              >
                <IconQrCode size={15} />
                <IconShare size={14} />
                <span>{t("shareQr")}</span>
              </button>
            </>
          )}
          <Link
            href="/taskln-service"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
          >
            <span>{t("findRequests")}</span>
            <IconChevronRight size={14} />
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
            <p className="text-xs font-semibold text-slate-500 mb-1">{t("activeJobs")}</p>
            <p className="text-2xl font-black text-amber-600">{data.active_job_count}</p>
            <p className="text-[11px] text-slate-400 mt-1">{t("inProgressHint")}</p>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
            <p className="text-xs font-semibold text-slate-500 mb-1">{t("completedJobs")}</p>
            <p className="text-2xl font-black text-emerald-600">{data.completed_job_count}</p>
            <p className="text-[11px] text-slate-400 mt-1">{t("completedHint")}</p>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
            <p className="text-xs font-semibold text-slate-500 mb-1">{t("walletBalance")}</p>
            <p className="text-2xl font-black text-slate-900">
              {Number(data.wallet_balance_xaf).toLocaleString()} <span className="text-xs font-medium text-slate-400">XAF</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-1">{t("payoutHint")}</p>
          </div>
        </div>

        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">{t("jobsTrend")}</h3>
            <span className="text-xs font-bold text-slate-500">{t("performancePeriod")}</span>
          </div>
          <p className="text-base font-extrabold text-slate-900">
            {data.jobs_trend.percent_change === null
              ? t("noHistoryYet")
              : `${data.jobs_trend.percent_change > 0 ? "+" : ""}${data.jobs_trend.percent_change}% ${t("vsLastPeriod")}`}
          </p>
          <p className="text-xs text-slate-400">
            {t("currentVsPrevious", { current: data.jobs_trend.current_period_value, previous: data.jobs_trend.previous_period_value })}
          </p>
        </div>

        {/* Job Dispatch Ledger — the real, currently-active job queue */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-slate-900">{t("dispatchLedger")}</h3>
          {data.active_jobs.length === 0 ? (
            <p className="text-xs text-slate-400">{t("noActiveJobs")}</p>
          ) : (
            <div className="space-y-2">
              {data.active_jobs.map((job) => (
                <Link
                  key={job.id}
                  href="/taskln-service"
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-100 transition-colors"
                >
                  <span className="text-xs font-bold text-slate-900">{labels.category(job.category)}</span>
                  {job.priority === "URGENT" && <Badge variant="clay">{t("urgent")}</Badge>}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Live location + weekly availability — without these, this
            technician can never actually be matched by "find nearby
            technicians" (radius search requires a recent location ping
            plus a schedule window covering right now). */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold text-slate-900">{t("liveLocationTitle")}</h3>
            <button
              onClick={handleShareLocation}
              disabled={locationStatus === "sharing"}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {locationStatus === "sharing" ? t("sharing") : locationStatus === "shared" ? t("locationShared") : t("shareLocation")}
            </button>
          </div>
          {locationStatus === "error" && <p className="text-xs text-rose-600">{t("locationError")}</p>}
          <div>
            <p className="text-xs text-slate-500 mb-2">{t("selectDays")}</p>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 7 }, (_, index) => (
                <button
                  key={index}
                  onClick={() => toggleDay(index)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                    availableDays.has(index) ? "bg-amber-400 border-amber-500 text-slate-950" : "bg-white border-slate-200 text-slate-500"
                  }`}
                >
                  {dayLabel(locale, index)}
                </button>
              ))}
            </div>
            <button
              onClick={handleSaveAvailability}
              disabled={savingAvailability}
              className="mt-3 px-4 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-800 hover:bg-slate-200 disabled:opacity-50"
            >
              {savingAvailability ? t("saving") : t("saveAvailability")}
            </button>
          </div>
        </div>

        {/* Facility contracts — docs/01 §2.4's recurring facility
            arrangements, with the "routine inspection logs" this
            dashboard was always meant to show. */}
        {facilityContracts.length > 0 && (
          <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900">{t("facilityContracts")}</h3>
            <div className="space-y-3">
              {facilityContracts.map((contract) => (
                <div key={contract.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="navy">{contract.frequency}</Badge>
                    <span className="text-[11px] text-slate-400">{t("since", { date: new Date(contract.start_date).toLocaleDateString(locale) })}</span>
                  </div>
                  <p className="text-xs text-slate-700">{contract.scope}</p>
                  {contract.visit_logs.length > 0 && (
                    <div className="space-y-1">
                      {contract.visit_logs.slice(0, 3).map((visit) => (
                        <p key={visit.id} className="text-[11px] text-slate-400">
                          {new Date(visit.visited_at).toLocaleDateString()} — {visit.notes}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      placeholder={t("logPlaceholder")}
                      value={visitNotes[contract.id] || ""}
                      onChange={(e) => setVisitNotes((prev) => ({ ...prev, [contract.id]: e.target.value }))}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200"
                    />
                    <button
                      onClick={() => handleLogVisit(contract.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800"
                    >
                      {t("logVisit")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked renovation/build projects — docs/01 §2.4's
            ProjectManagementCase, with milestones this technician can
            mark complete. */}
        {projectCases.length > 0 && (
          <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900">{t("linkedProjects")}</h3>
            <div className="space-y-3">
              {projectCases.map((project) => (
                <div key={project.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-slate-900">{project.title}</p>
                    <Badge variant={project.status === "COMPLETED" ? "green" : "gold"}>{project.status}</Badge>
                  </div>
                  {project.milestones.filter((m) => m.status !== "COMPLETED").length === 0 ? (
                    <p className="text-[11px] text-slate-400">{t("noPendingMilestones")}</p>
                  ) : (
                    <div className="space-y-1">
                      {project.milestones.filter((m) => m.status !== "COMPLETED").map((milestone) => (
                        <div key={milestone.id} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-700">{milestone.title}</span>
                          <button
                            onClick={() => handleCompleteMilestone(project.id, milestone.id)}
                            className="text-[11px] font-bold text-slate-900 underline"
                          >
                            {t("markComplete")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Real Mobile Money Payout & Withdrawal Module */}
        <WalletPayoutCard
          title={t("walletTitle")}
          subtitle={t("walletSubtitle")}
        />
      </div>

      {userId && (
        <ShareAndQrModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          url={shareUrl}
          title={t("shareModalTitle")}
          subtitle={t("shareModalSubtitle")}
        />
      )}
    </DashboardLayout>
  );
}

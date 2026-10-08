"use client";
import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listMaintenanceRequests, addMaintenanceCost, closeMaintenanceRequest,
  listTenantScreenings, consentToScreening, generateScreeningReport,
  listSafetyCheckIns, startSafetyCheckIn, checkOutSafely,
  listLeases, createLease, listMyBookings,
  listFacilityContracts, createFacilityContract, logFacilityVisit,
  listProjectCases, createProjectCase, linkProjectTechnician, addProjectMilestone, completeProjectMilestone,
  getBoostPriceQuote, purchaseCampaignBoost, getMyAdCampaigns,
  type MaintenanceRequestItem, type TenantScreeningItem, type SafetyCheckInItem, type LeaseItem, type BookingItem,
  type FacilityContractItem, type ProjectCaseItem, type AdCampaignItem,
} from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

type Tab = "maintenance" | "screening" | "safety" | "leases" | "facility" | "projects" | "boosts";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15";
const cardCls = "rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm";
const formCls = `${cardCls} mb-6 flex flex-col gap-3`;
const formTitleCls = "text-base font-black tracking-tight text-slate-900";
const linkBtnCls = "text-xs font-bold text-slate-700 rounded-xl border border-slate-200 px-3 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer";
const solidBtnCls = "bg-slate-900 text-amber-300 text-xs font-bold px-4 py-2 rounded-xl hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer";
const softBtnCls = "bg-slate-100 text-slate-700 text-xs font-bold px-4 py-2 rounded-xl hover:bg-slate-200 transition-colors whitespace-nowrap cursor-pointer";

/**
 * Property Management — a real gap this closes: maintenance tracking,
 * tenant screening, and agent safety check-ins all had real, working
 * backend logic with zero way to reach any of it. Same tabbed pattern
 * as the Admin Console, built on the shared UI foundation
 * (PageHeader, EmptyState, Badge, Button) from earlier this session.
 * Facility Contracts / Projects tabs close docs/01 §2.4's
 * FacilityManagementContract/ProjectManagementCase, previously
 * modeled nowhere at all.
 */
export default function PropertyManagementPage() {
  const t = useTranslations("PropertyManagementPage");
  const [tab, setTab] = useState<Tab>("maintenance");
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequestItem[]>([]);
  const [screenings, setScreenings] = useState<TenantScreeningItem[]>([]);
  const [checkIns, setCheckIns] = useState<SafetyCheckInItem[]>([]);
  const [leases, setLeases] = useState<LeaseItem[]>([]);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [leaseBookingId, setLeaseBookingId] = useState("");
  const [leaseStart, setLeaseStart] = useState("");
  const [leaseEnd, setLeaseEnd] = useState("");
  const [leaseError, setLeaseError] = useState("");
  const [leaseSubmitting, setLeaseSubmitting] = useState(false);

  const [facilityContracts, setFacilityContracts] = useState<FacilityContractItem[]>([]);
  const [contractTargetId, setContractTargetId] = useState("");
  const [contractScope, setContractScope] = useState("");
  const [contractFrequency, setContractFrequency] = useState("MONTHLY");
  const [contractStartDate, setContractStartDate] = useState("");
  const [contractTechnicianId, setContractTechnicianId] = useState("");
  const [contractSubmitting, setContractSubmitting] = useState(false);
  const [visitNotes, setVisitNotes] = useState<Record<string, string>>({});

  const [projectCases, setProjectCases] = useState<ProjectCaseItem[]>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectBudget, setProjectBudget] = useState("");
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [linkTechnicianId, setLinkTechnicianId] = useState<Record<string, string>>({});
  const [milestoneForms, setMilestoneForms] = useState<Record<string, { title: string; budget: string; dueDate: string }>>({});

  const [adCampaigns, setAdCampaigns] = useState<AdCampaignItem[]>([]);
  const [boostPlacement, setBoostPlacement] = useState("FEED_BOOSTED_POST");
  const [boostDurationUnit, setBoostDurationUnit] = useState("DAILY");
  const [boostDurationQuantity, setBoostDurationQuantity] = useState("1");
  const [boostTargetListingId, setBoostTargetListingId] = useState("");
  const [boostPhone, setBoostPhone] = useState("");
  const [boostQuote, setBoostQuote] = useState<string | null>(null);
  const [boostStatus, setBoostStatus] = useState<"idle" | "quoting" | "purchasing" | "error">("idle");
  const [boostError, setBoostError] = useState("");

  const loadAll = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([
      listMaintenanceRequests(token), listTenantScreenings(token), listSafetyCheckIns(token), listLeases(token), listMyBookings(token),
      listFacilityContracts(token), listProjectCases(token), getMyAdCampaigns(token),
    ])
      .then(([maintenanceData, screeningData, checkInData, leaseData, bookingData, facilityData, projectData, adCampaignData]) => {
        setMaintenanceRequests(maintenanceData.results);
        setScreenings(screeningData.results);
        setCheckIns(checkInData.results);
        setLeases(leaseData.results);
        setBookings(bookingData.results);
        setFacilityContracts(facilityData.results);
        setProjectCases(projectData.results);
        setAdCampaigns(adCampaignData.results);
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

  async function handleCreateFacilityContract(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !contractTargetId || !contractScope || !contractStartDate) return;
    setContractSubmitting(true);
    try {
      await createFacilityContract({
        target_content_type: "property.PropertyAsset", target_id: contractTargetId, scope: contractScope,
        frequency: contractFrequency, start_date: contractStartDate,
        technician: contractTechnicianId || undefined,
      }, token);
      setContractTargetId(""); setContractScope(""); setContractStartDate(""); setContractTechnicianId("");
      loadAll();
    } finally {
      setContractSubmitting(false);
    }
  }

  async function handleLogVisit(contractId: string) {
    const token = localStorage.getItem("access_token");
    const notes = visitNotes[contractId];
    if (!token || !notes) return;
    await logFacilityVisit(contractId, notes, token);
    setVisitNotes((prev) => ({ ...prev, [contractId]: "" }));
    loadAll();
  }

  async function handleCreateProjectCase(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !projectTitle || !projectBudget) return;
    setProjectSubmitting(true);
    try {
      await createProjectCase({ title: projectTitle, description: projectDescription, budget_xaf: projectBudget }, token);
      setProjectTitle(""); setProjectDescription(""); setProjectBudget("");
      loadAll();
    } finally {
      setProjectSubmitting(false);
    }
  }

  async function handleLinkTechnician(caseId: string) {
    const token = localStorage.getItem("access_token");
    const technicianId = linkTechnicianId[caseId];
    if (!token || !technicianId) return;
    await linkProjectTechnician(caseId, technicianId, token);
    setLinkTechnicianId((prev) => ({ ...prev, [caseId]: "" }));
    loadAll();
  }

  async function handleAddMilestone(caseId: string) {
    const token = localStorage.getItem("access_token");
    const form = milestoneForms[caseId];
    if (!token || !form?.title || !form?.budget) return;
    await addProjectMilestone(caseId, { title: form.title, budget_allocation_xaf: form.budget, due_date: form.dueDate || undefined }, token);
    setMilestoneForms((prev) => ({ ...prev, [caseId]: { title: "", budget: "", dueDate: "" } }));
    loadAll();
  }

  async function handleCompleteMilestone(caseId: string, milestoneId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await completeProjectMilestone(caseId, milestoneId, token);
    loadAll();
  }

  async function handleGetBoostQuote() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBoostStatus("quoting");
    setBoostError("");
    try {
      const result = await getBoostPriceQuote(boostPlacement, boostDurationUnit, Number(boostDurationQuantity), token);
      setBoostQuote(result.total_price_xaf);
      setBoostStatus("idle");
    } catch (err) {
      setBoostError(err instanceof Error ? err.message : "Could not get a price quote.");
      setBoostStatus("error");
    }
  }

  async function handlePurchaseBoost(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !boostPhone) return;
    setBoostStatus("purchasing");
    setBoostError("");
    try {
      await purchaseCampaignBoost({
        placement: boostPlacement, duration_unit: boostDurationUnit, duration_quantity: Number(boostDurationQuantity),
        phone_number: boostPhone, target_listing_id: boostTargetListingId || undefined,
      }, token);
      setBoostQuote(null);
      setBoostTargetListingId("");
      loadAll();
      setBoostStatus("idle");
    } catch (err) {
      setBoostError(err instanceof Error ? err.message : "Could not purchase this boost.");
      setBoostStatus("error");
    }
  }

  async function handleCreateLease(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !leaseBookingId || !leaseStart || !leaseEnd) return;
    setLeaseError("");
    setLeaseSubmitting(true);
    try {
      await createLease({ booking: leaseBookingId, start_date: leaseStart, end_date: leaseEnd }, token);
      setLeaseBookingId("");
      setLeaseStart("");
      setLeaseEnd("");
      loadAll();
    } catch (err) {
      setLeaseError(err instanceof Error ? err.message : t("leaseCreateFailed"));
    } finally {
      setLeaseSubmitting(false);
    }
  }

  if (status === "signedOut") {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/property-management" title={t("title")} subtitle={t("subtitle")}>
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout currentRole="landlord" activeHref="/property-management" title={t("title")} subtitle={t("subtitle")}>
      <div className="flex gap-2 mb-8 flex-wrap">
        {(["maintenance", "screening", "safety", "leases", "facility", "projects", "boosts"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-full text-sm font-bold border transition-colors cursor-pointer ${
              tab === key ? "bg-slate-900 text-white border-slate-900 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {t(`tab_${key}`)}
          </button>
        ))}
      </div>

      {status === "loading" ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : tab === "maintenance" ? (
        maintenanceRequests.length === 0 ? (
          <EmptyState icon="🔧" title={t("noMaintenanceYet")} />
        ) : (
          <div className="flex flex-col gap-3">
            {maintenanceRequests.map((request) => (
              <div key={request.id} className={cardCls}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Badge variant={request.category === "EMERGENCY" ? "clay" : "neutral"}>{request.category}</Badge>
                  <Badge variant={request.status === "CLOSED" ? "green" : "gold"}>{request.status}</Badge>
                </div>
                <p className="text-sm text-slate-700 mb-2">{request.description}</p>
                {request.cost_estimate_xaf && (
                  <p className="text-sm font-black text-slate-900 mb-2">{t("totalCost")}: {Number(request.cost_estimate_xaf).toLocaleString()} XAF</p>
                )}
                {request.status !== "CLOSED" && (
                  <button onClick={() => handleCloseMaintenance(request.id)} className={linkBtnCls}>
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
              <div key={screening.id} className={cardCls}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-black text-slate-900">{screening.prospective_tenant_name}</p>
                  <Badge variant={screening.status === "COMPLETED" ? "green" : "gold"}>{screening.status}</Badge>
                </div>
                {screening.report_summary && (
                  <div className="text-xs text-slate-600 mb-2">
                    <p>{t("completedBookings")}: {screening.report_summary.completed_bookings}</p>
                    <p>{t("warnings")}: {screening.report_summary.warning_count}</p>
                  </div>
                )}
                {screening.status === "PENDING_CONSENT" && (
                  <button onClick={() => handleConsent(screening.id)} className={linkBtnCls}>
                    {t("grantConsent")}
                  </button>
                )}
                {screening.status === "CONSENTED" && (
                  <button onClick={() => handleGenerateReport(screening.id)} className={linkBtnCls}>
                    {t("generateReport")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === "safety" ? (
        checkIns.length === 0 ? (
          <EmptyState icon="🦺" title={t("noCheckInsYet")} />
        ) : (
          <div className="flex flex-col gap-3">
            {checkIns.map((checkIn) => (
              <div key={checkIn.id} className={cardCls}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-black text-slate-900">{checkIn.emergency_contact_name}</p>
                  <Badge variant={checkIn.status === "ACTIVE" ? "gold" : checkIn.status === "ALERT_TRIGGERED" ? "clay" : "green"}>{checkIn.status}</Badge>
                </div>
                <p className="text-xs text-slate-500 mb-2">{t("expectedBy")}: {new Date(checkIn.expected_checkout_at).toLocaleString()}</p>
                {checkIn.status === "ACTIVE" && (
                  <button onClick={() => handleCheckOut(checkIn.id)} className={linkBtnCls}>
                    {t("checkOutNow")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === "leases" ? (
        <div>
          {(() => {
            const leasedBookingIds = new Set(leases.map((l) => l.booking));
            const eligibleBookings = bookings.filter((b) => b.status === "COMPLETED" && !leasedBookingIds.has(b.id));
            return eligibleBookings.length > 0 ? (
              <form onSubmit={handleCreateLease} className={formCls}>
                <p className={formTitleCls}>{t("createLeaseTitle")}</p>
                <select
                  required value={leaseBookingId} onChange={(e) => setLeaseBookingId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">{t("selectBooking")}</option>
                  {eligibleBookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.booking_type.replace(/_/g, " ")} — {Number(b.amount_xaf).toLocaleString()} XAF — {new Date(b.created_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <input required type="date" value={leaseStart} onChange={(e) => setLeaseStart(e.target.value)} className={inputCls} />
                  <input required type="date" value={leaseEnd} onChange={(e) => setLeaseEnd(e.target.value)} className={inputCls} />
                </div>
                {leaseError && <p className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{leaseError}</p>}
                <Button disabled={leaseSubmitting}>{leaseSubmitting ? t("submitting") : t("createLeaseButton")}</Button>
              </form>
            ) : null;
          })()}

          {leases.length === 0 ? (
            <EmptyState icon="📄" title={t("noLeasesYet")} />
          ) : (
            <div className="flex flex-col gap-3">
              {leases.map((lease) => (
                <div key={lease.id} className={cardCls}>
                  <p className="text-sm font-black text-slate-900 mb-1">
                    {new Date(lease.start_date).toLocaleDateString()} → {new Date(lease.end_date).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-slate-500">{t("leaseBookingRef")}: {lease.booking.slice(0, 8)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : tab === "facility" ? (
        <div>
          <form onSubmit={handleCreateFacilityContract} className={formCls}>
            <p className={formTitleCls}>{t("createContractTitle")}</p>
            <input required placeholder={t("contractPropertyIdPlaceholder")} value={contractTargetId} onChange={(e) => setContractTargetId(e.target.value)} className={inputCls} />
            <textarea required rows={2} placeholder={t("contractScopePlaceholder")} value={contractScope} onChange={(e) => setContractScope(e.target.value)} className={inputCls} />
            <div className="grid grid-cols-2 gap-3">
              <select value={contractFrequency} onChange={(e) => setContractFrequency(e.target.value)} className={inputCls}>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
              </select>
              <input required type="date" value={contractStartDate} onChange={(e) => setContractStartDate(e.target.value)} className={inputCls} />
            </div>
            <input placeholder={t("contractTechnicianIdPlaceholder")} value={contractTechnicianId} onChange={(e) => setContractTechnicianId(e.target.value)} className={inputCls} />
            <Button disabled={contractSubmitting}>{contractSubmitting ? t("submitting") : t("createContractButton")}</Button>
          </form>

          {facilityContracts.length === 0 ? (
            <EmptyState icon="🏗️" title={t("noFacilityContractsYet")} />
          ) : (
            <div className="flex flex-col gap-3">
              {facilityContracts.map((contract) => (
                <div key={contract.id} className={cardCls}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <Badge variant={contract.is_active ? "green" : "neutral"}>{contract.frequency}</Badge>
                    <p className="text-xs text-slate-500">{new Date(contract.start_date).toLocaleDateString()}</p>
                  </div>
                  <p className="text-sm text-slate-700 mb-2">{contract.scope}</p>
                  {contract.technician_name && <p className="text-xs text-slate-500 mb-2">Technician: {contract.technician_name}</p>}

                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{t("visitLogsTitle")}</p>
                    {contract.visit_logs.length === 0 ? (
                      <p className="text-xs text-slate-400 mb-2">—</p>
                    ) : (
                      <div className="flex flex-col gap-1 mb-2">
                        {contract.visit_logs.map((visit) => (
                          <p key={visit.id} className="text-xs text-slate-600">
                            {new Date(visit.visited_at).toLocaleDateString()} — {visit.logged_by_name}: {visit.notes}
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        placeholder={t("logVisitPlaceholder")}
                        value={visitNotes[contract.id] || ""}
                        onChange={(e) => setVisitNotes((prev) => ({ ...prev, [contract.id]: e.target.value }))}
                        className={`flex-1 ${inputCls}`}
                      />
                      <button onClick={() => handleLogVisit(contract.id)} className={solidBtnCls}>
                        {t("logVisitButton")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : tab === "projects" ? (
        <div>
          <form onSubmit={handleCreateProjectCase} className={formCls}>
            <p className={formTitleCls}>{t("createProjectTitle")}</p>
            <input required placeholder={t("projectTitlePlaceholder")} value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} className={inputCls} />
            <textarea rows={2} placeholder={t("projectDescriptionPlaceholder")} value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} className={inputCls} />
            <input required type="number" placeholder={t("projectBudgetPlaceholder")} value={projectBudget} onChange={(e) => setProjectBudget(e.target.value)} className={inputCls} />
            <Button disabled={projectSubmitting}>{projectSubmitting ? t("submitting") : t("createProjectButton")}</Button>
          </form>

          {projectCases.length === 0 ? (
            <EmptyState icon="🏚️" title={t("noProjectsYet")} />
          ) : (
            <div className="flex flex-col gap-4">
              {projectCases.map((project) => (
                <div key={project.id} className={cardCls}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-base font-black tracking-tight text-slate-900">{project.title}</p>
                    <Badge variant={project.status === "COMPLETED" ? "green" : "gold"}>{project.status}</Badge>
                  </div>
                  <p className="text-sm text-slate-600 mb-2">{project.description}</p>
                  <p className="text-sm font-black text-slate-900 mb-2">{Number(project.budget_xaf).toLocaleString()} XAF</p>
                  {project.technician_names.length > 0 && (
                    <p className="text-xs text-slate-500 mb-2">Technicians: {project.technician_names.join(", ")}</p>
                  )}

                  <div className="flex gap-2 mb-3">
                    <input
                      placeholder={t("linkTechnicianPlaceholder")}
                      value={linkTechnicianId[project.id] || ""}
                      onChange={(e) => setLinkTechnicianId((prev) => ({ ...prev, [project.id]: e.target.value }))}
                      className={`flex-1 ${inputCls}`}
                    />
                    <button onClick={() => handleLinkTechnician(project.id)} className={softBtnCls}>
                      {t("linkTechnicianButton")}
                    </button>
                  </div>

                  <div className="pt-3 border-t border-slate-100">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{t("milestonesTitle")}</p>
                    {project.milestones.length === 0 ? (
                      <p className="text-xs text-slate-400 mb-2">—</p>
                    ) : (
                      <div className="flex flex-col gap-1.5 mb-2">
                        {project.milestones.map((milestone) => (
                          <div key={milestone.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className={milestone.status === "COMPLETED" ? "text-slate-400 line-through" : "text-slate-700"}>
                              {milestone.title} — {Number(milestone.budget_allocation_xaf).toLocaleString()} XAF
                            </span>
                            {milestone.status !== "COMPLETED" && (
                              <button onClick={() => handleCompleteMilestone(project.id, milestone.id)} className={linkBtnCls}>
                                {t("completeMilestoneButton")}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2 mt-4">{t("addMilestoneTitle")}</p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        placeholder={t("milestoneTitlePlaceholder")}
                        value={milestoneForms[project.id]?.title || ""}
                        onChange={(e) => setMilestoneForms((prev) => ({ ...prev, [project.id]: { ...(prev[project.id] || { budget: "", dueDate: "" }), title: e.target.value } }))}
                        className={`flex-1 min-w-[140px] ${inputCls}`}
                      />
                      <input
                        type="number"
                        placeholder={t("milestoneBudgetPlaceholder")}
                        value={milestoneForms[project.id]?.budget || ""}
                        onChange={(e) => setMilestoneForms((prev) => ({ ...prev, [project.id]: { ...(prev[project.id] || { title: "", dueDate: "" }), budget: e.target.value } }))}
                        className={`w-40 ${inputCls}`}
                      />
                      <button onClick={() => handleAddMilestone(project.id)} className={solidBtnCls}>
                        {t("addMilestoneButton")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <form onSubmit={handlePurchaseBoost} className={formCls}>
            <p className={formTitleCls}>{t("createBoostTitle")}</p>
            <div className="grid grid-cols-2 gap-3">
              <select value={boostPlacement} onChange={(e) => { setBoostPlacement(e.target.value); setBoostQuote(null); }} className={inputCls}>
                <option value="FEED_BOOSTED_POST">{t("boostPlacementFeed")}</option>
                <option value="SEARCH_TOP_PLACEMENT">{t("boostPlacementSearch")}</option>
                <option value="QUARTER_FEATURED_LISTING">{t("boostPlacementFeatured")}</option>
              </select>
              <select value={boostDurationUnit} onChange={(e) => { setBoostDurationUnit(e.target.value); setBoostQuote(null); }} className={inputCls}>
                <option value="HOURLY">{t("boostDurationHourly")}</option>
                <option value="DAILY">{t("boostDurationDaily")}</option>
                <option value="MONTHLY">{t("boostDurationMonthly")}</option>
                <option value="YEARLY">{t("boostDurationYearly")}</option>
              </select>
            </div>
            <input
              type="number"
              min={1}
              placeholder={t("boostDurationQuantityPlaceholder")}
              value={boostDurationQuantity}
              onChange={(e) => { setBoostDurationQuantity(e.target.value); setBoostQuote(null); }}
              className={inputCls}
            />
            <input
              placeholder={t("boostTargetListingPlaceholder")}
              value={boostTargetListingId}
              onChange={(e) => setBoostTargetListingId(e.target.value)}
              className={inputCls}
            />

            <button type="button" onClick={handleGetBoostQuote} disabled={boostStatus === "quoting"} className={`${softBtnCls} self-start`}>
              {boostStatus === "quoting" ? t("submitting") : t("getQuoteButton")}
            </button>

            {boostQuote !== null && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-black text-slate-900">{t("boostQuoteLabel")}: {Number(boostQuote).toLocaleString()} XAF</p>
            )}

            <input
              required
              placeholder={t("boostPhonePlaceholder")}
              value={boostPhone}
              onChange={(e) => setBoostPhone(e.target.value)}
              className={inputCls}
            />
            {boostError && <p className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{boostError}</p>}
            <Button disabled={boostStatus === "purchasing"}>{boostStatus === "purchasing" ? t("submitting") : t("purchaseBoostButton")}</Button>
          </form>

          {adCampaigns.length === 0 ? (
            <EmptyState icon="📣" title={t("noBoostsYet")} />
          ) : (
            <div className="flex flex-col gap-3">
              {adCampaigns.map((campaign) => (
                <div key={campaign.id} className={cardCls}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <Badge variant={campaign.status === "ACTIVE" ? "green" : "neutral"}>{campaign.status}</Badge>
                    <p className="text-xs text-slate-500">{campaign.placement}</p>
                  </div>
                  <p className="text-sm text-slate-700 mb-1">
                    {t("boostBudgetLabel")}: {Number(campaign.budget_xaf).toLocaleString()} XAF — {t("boostSpentLabel")}: {Number(campaign.spent_so_far_xaf).toLocaleString()} XAF
                  </p>
                  {campaign.ends_at && <p className="text-xs text-slate-500">{t("boostEndsLabel")}: {new Date(campaign.ends_at).toLocaleDateString()}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}

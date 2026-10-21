"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTasklnLabels } from "@/lib/useTasklnLabels";
import { Link } from "@/i18n/navigation";
import {
  getAdminConsoleSummary,
  listAdminVerificationRequests,
  approveVerificationRequest,
  rejectVerificationRequest,
  listAdminKycReviews,
  approveKyc,
  rejectKyc,
  listAdminContentReports,
  resolveContentReport,
  listAdminDisputeCases,
  respondToDispute,
  resolveDispute,
  listHotelsForAdmin,
  verifyHotel,
  listVenuesForAdmin,
  verifyVenue,
  listDriversForAdmin,
  verifyDriver,
  listTechniciansForAdmin,
  verifyTechnician,
  reviewTechnician,
  listAdminServiceDisputes,
  resolveAdminServiceDispute,
  listAdminPendingPropertyListings,
  approvePropertyListing,
  rejectPropertyListing,
  listAdminWelfareAlerts,
  resolveAdminWelfareAlert,
  listAdminSosRides,
  resolveAdminSosRide,
  listAdminUsers,
  toggleAdminUserSuspend,
  issueAdminUserStrike,
  assignAdminUserRole,
  removeAdminUserRole,
  getAdminGreetingSettings,
  updateAdminGreetingSettings,
  type AdminGreetingSettings,
  type AdminConsoleSummary,
  type AdminVerificationRequest,
  type AdminKycReviewItem,
  type AdminContentReport,
  type AdminDisputeCase,
  type AdminServiceDisputeItem,
  type ServiceDisputeOutcome,
  type Hotel,
  type Venue,
  type DriverProfileItem,
  type TechnicianProfileItem,
  type Listing,
  type AdminWelfareAlert,
  type AdminSosRide,
  type AdminUser,
  type AssignableRole,
} from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import DisputeChat from "@/components/DisputeChat";
import AdminFaqManager from "@/components/admin/AdminFaqManager";
import {
  IconShield,
  IconShieldCheck,
  IconClock,
  IconLock,
  IconUsers,
  IconAlertCircle,
  IconSparkles,
  IconBuilding,
  IconHome,
  IconGraduationCap,
  IconParty,
  IconHotel,
  IconCar,
  IconMapPin,
  IconCheckCircle,
  IconChevronRight,
  IconArrowUpRight,
  IconRefresh,
} from "@/components/Icons";

type Tab =
  | "summary"
  | "properties"
  | "listings"
  | "verifications"
  | "kyc"
  | "reports"
  | "disputes"
  | "welfare"
  | "sos"
  | "users"
  | "greetings"
  | "faqs";

export default function AdminConsolePage() {
  const t = useTranslations("AdminConsolePage");
  const taskln = useTasklnLabels();
  const [tab, setTab] = useState<Tab>("summary");
  const [status, setStatus] = useState<"loading" | "signedOut" | "notAdmin" | "ready">("loading");
  const [summary, setSummary] = useState<AdminConsoleSummary | null>(null);

  // Queues
  const [pendingProperties, setPendingProperties] = useState<Listing[]>([]);
  const [pendingHotels, setPendingHotels] = useState<Hotel[]>([]);
  const [pendingVenues, setPendingVenues] = useState<Venue[]>([]);
  const [pendingDrivers, setPendingDrivers] = useState<DriverProfileItem[]>([]);
  const [pendingTechnicians, setPendingTechnicians] = useState<TechnicianProfileItem[]>([]);
  const [verifiedTechnicians, setVerifiedTechnicians] = useState<TechnicianProfileItem[]>([]);
  const [verifications, setVerifications] = useState<AdminVerificationRequest[]>([]);
  const [kycReviews, setKycReviews] = useState<AdminKycReviewItem[]>([]);
  const [reports, setReports] = useState<AdminContentReport[]>([]);
  const [disputes, setDisputes] = useState<AdminDisputeCase[]>([]);
  const [serviceDisputes, setServiceDisputes] = useState<AdminServiceDisputeItem[]>([]);
  const [activeDisputeChatId, setActiveDisputeChatId] = useState<string | null>(null);
  const [welfareAlerts, setWelfareAlerts] = useState<AdminWelfareAlert[]>([]);
  const [sosRides, setSosRides] = useState<AdminSosRide[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userStatusFilter, setUserStatusFilter] = useState<string>("ALL");
  const [userRoleFilter, setUserRoleFilter] = useState<string>("ALL");
  const [usersPage, setUsersPage] = useState(1);
  const [usersCount, setUsersCount] = useState(0);
  const [usersHasNext, setUsersHasNext] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [roleManagerUserId, setRoleManagerUserId] = useState<string | null>(null);
  const [roleActionBusy, setRoleActionBusy] = useState(false);

  // Celebratory greetings settings (Birthday & Happy New Month)
  const [greetingSettings, setGreetingSettings] = useState<AdminGreetingSettings | null>(null);
  const [savingGreetings, setSavingGreetings] = useState(false);
  const [greetingSaveSuccess, setGreetingSaveSuccess] = useState(false);

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  // Real server-side filtering + pagination for the Users queue —
  // account_status/role are sent to the API and paged with ?page=,
  // rather than only ever filtering whatever single page of users
  // happened to already be loaded client-side.
  const loadUsers = useCallback(
    (page: number) => {
      if (!token) return;
      setUsersLoading(true);
      const statusParam = userStatusFilter === "ALL" ? undefined : userStatusFilter;
      const roleParam = userRoleFilter === "ALL" ? undefined : userRoleFilter.toLowerCase();
      listAdminUsers(token, statusParam, roleParam, page)
        .then((data) => {
          setUsers(data.results || []);
          setUsersCount(data.count || 0);
          setUsersHasNext(Boolean(data.next));
          setUsersPage(page);
        })
        .catch(() => {})
        .finally(() => setUsersLoading(false));
    },
    [token, userStatusFilter, userRoleFilter]
  );

  useEffect(() => {
    loadUsers(1);
  }, [loadUsers]);

  const loadAll = useCallback(() => {
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([
      getAdminConsoleSummary(token),
      listAdminPendingPropertyListings(token),
      listAdminVerificationRequests(token),
      listAdminKycReviews(token),
      listAdminContentReports(token),
      listAdminDisputeCases(token),
      listHotelsForAdmin(token),
      listVenuesForAdmin(token),
      listDriversForAdmin(token),
      listTechniciansForAdmin(token),
      listAdminWelfareAlerts(token),
      getAdminGreetingSettings(token).catch(() => null),
      listAdminServiceDisputes(token).catch(() => [] as AdminServiceDisputeItem[]),
      listTechniciansForAdmin(token, "verified").catch(() => ({ results: [] as TechnicianProfileItem[] })),
      listAdminSosRides(token).catch(() => ({ count: 0, results: [] as AdminSosRide[] })),
    ])
      .then(
        ([
          summaryData,
          propertiesData,
          verificationsData,
          kycReviewsData,
          reportsData,
          disputesData,
          hotelsData,
          venuesData,
          driversData,
          techniciansData,
          welfareData,
          greetingsData,
          serviceDisputesData,
          verifiedTechniciansData,
          sosRidesData,
        ]) => {
          setSummary(summaryData);
          setPendingProperties(propertiesData.results || []);
          setVerifications(verificationsData.results || []);
          setKycReviews(kycReviewsData.results || []);
          setReports(reportsData.results || []);
          setDisputes(disputesData.results || []);
          setPendingHotels((hotelsData.results || []).filter((h) => !h.verified));
          setPendingVenues((venuesData.results || []).filter((v) => !v.verified));
          setPendingDrivers(driversData.results || []);
          setPendingTechnicians(techniciansData.results || []);
          setWelfareAlerts(welfareData.results || []);
          if (greetingsData) setGreetingSettings(greetingsData);
          setServiceDisputes(serviceDisputesData);
          setVerifiedTechnicians(verifiedTechniciansData.results || []);
          setSosRides(sosRidesData.results || []);
          setStatus("ready");
        }
      )
      .catch(() => setStatus("notAdmin"));
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadAll();
    loadUsers(usersPage);
    setTimeout(() => setIsRefreshing(false), 600);
  }, [loadAll, loadUsers, usersPage]);

  // Actions: Property listings
  async function handleApproveProperty(id: string) {
    if (!token) return;
    const res = await approvePropertyListing(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleRejectProperty(id: string) {
    if (!token) return;
    const res = await rejectPropertyListing(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Verifications
  async function handleApproveVerification(id: string) {
    if (!token) return;
    const res = await approveVerificationRequest(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleRejectVerification(id: string) {
    if (!token) return;
    const reason = prompt(t("rejectReasonPlaceholder")) || "";
    const res = await rejectVerificationRequest(id, reason, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: KYC Review
  async function handleApproveKyc(id: number) {
    if (!token) return;
    const res = await approveKyc(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleRejectKyc(id: number) {
    if (!token) return;
    const reason = prompt(t("rejectReasonPlaceholder")) || "";
    const res = await rejectKyc(id, reason, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Reports
  async function handleResolveReport(id: string) {
    if (!token) return;
    const actionTaken = prompt(t("actionTakenPlaceholder"));
    if (!actionTaken) return;
    const issueStrike = confirm(t("issueStrike"));
    const res = await resolveContentReport(id, actionTaken, issueStrike, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Disputes
  async function handleRespondDispute(id: string) {
    if (!token) return;
    const res = await respondToDispute(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleResolveDispute(id: string, outcome: "RELEASE" | "REFUND") {
    if (!token) return;
    const notes = prompt(t("resolutionNotesPlaceholder")) || "";
    const res = await resolveDispute(id, outcome, notes, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Hospitality & Drivers
  async function handleResolveServiceDispute(id: string, outcome: ServiceDisputeOutcome) {
    if (!token) return;
    const notes = prompt(t("resolutionNotesPlaceholder")) || "";
    const res = await resolveAdminServiceDispute(id, outcome, notes, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Hospitality & Drivers
  async function handleVerifyHotel(id: string) {
    if (!token) return;
    const res = await verifyHotel(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleVerifyVenue(id: string) {
    if (!token) return;
    const res = await verifyVenue(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleVerifyDriver(id: number) {
    if (!token) return;
    const res = await verifyDriver(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleVerifyTechnician(id: number) {
    if (!token) return;
    const res = await verifyTechnician(id, token);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(body?.detail || t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Student Welfare
  async function handleReviewTechnician(id: number, action: "reject" | "revoke") {
    if (!token) return;
    const reason = (prompt(t(action === "reject" ? "technicianRejectPrompt" : "technicianRevokePrompt")) || "").trim();
    if (reason.length < 3) return;
    const res = await reviewTechnician(id, action, reason, token);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(body?.detail || t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Student Welfare
  async function handleResolveWelfare(id: string) {
    if (!token) return;
    const res = await resolveAdminWelfareAlert(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: OaziGo SOS
  async function handleResolveSos(id: string) {
    if (!token) return;
    const res = await resolveAdminSosRide(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Celebratory Greetings Settings
  async function handleSaveGreetingSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !greetingSettings) return;
    setSavingGreetings(true);
    setGreetingSaveSuccess(false);
    try {
      const updated = await updateAdminGreetingSettings(greetingSettings, token);
      setGreetingSettings(updated);
      setGreetingSaveSuccess(true);
      setTimeout(() => setGreetingSaveSuccess(false), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setSavingGreetings(false);
    }
  }

  // Actions: User Management
  async function handleToggleSuspendUser(id: string, currentStatus: string) {
    if (!token) return;
    const shouldSuspend = currentStatus === "ACTIVE";
    const days = shouldSuspend ? Number(prompt("Suspend for how many days?", "30") || 30) : 0;
    const res = await toggleAdminUserSuspend(id, shouldSuspend, days, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadUsers(usersPage);
    getAdminConsoleSummary(token).then(setSummary).catch(() => {});
  }

  async function handleIssueUserStrike(id: string) {
    if (!token) return;
    const reason = prompt("Reason for manual strike (e.g. REPEATED_VIOLATION, SCAM_ATTEMPT):", "REPEATED_VIOLATION");
    if (!reason) return;
    const res = await issueAdminUserStrike(id, reason, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadUsers(usersPage);
    getAdminConsoleSummary(token).then(setSummary).catch(() => {});
  }

  const ASSIGNABLE_ROLES: { value: AssignableRole; label: string }[] = [
    { value: "landlord", label: "Landlord" },
    { value: "agent", label: "Agent" },
    { value: "agency", label: "Agency" },
    { value: "student", label: "Student" },
    { value: "technician", label: "Technician" },
    { value: "driver", label: "Driver" },
    { value: "admin", label: "Admin" },
  ];

  async function handleAssignRole(id: string, role: AssignableRole) {
    if (!token || roleActionBusy) return;
    setRoleActionBusy(true);
    try {
      await assignAdminUserRole(id, role, {}, token);
      loadUsers(usersPage);
    } catch (err) {
      alert(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setRoleActionBusy(false);
    }
  }

  async function handleRemoveRole(id: string, role: AssignableRole) {
    if (!token || roleActionBusy) return;
    if (!confirm(`Remove the "${role}" role from this user?`)) return;
    setRoleActionBusy(true);
    try {
      await removeAdminUserRole(id, role, token);
      loadUsers(usersPage);
    } catch (err) {
      alert(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setRoleActionBusy(false);
    }
  }

  if (status === "signedOut") {
    return (
      <main className="min-h-[calc(100vh-140px)] flex items-center justify-center py-16 px-4 bg-slate-50">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-slate-200/80 shadow-xl text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <IconLock size={28} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Admin Authentication Required</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            Please sign in with a registered platform administrative account to access the trust &amp; verification queues.
          </p>
          <Button href="/admin/login" className="w-full py-2.5 rounded-xl font-bold">
            {t("signInRequired")}
          </Button>
        </div>
      </main>
    );
  }

  if (status === "notAdmin") {
    return (
      <main className="min-h-[calc(100vh-140px)] flex items-center justify-center py-16 px-4 bg-slate-50">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-slate-200/80 shadow-xl text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
            <IconAlertCircle size={28} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">{t("notAdmin")}</p>
          <Button href="/" variant="secondary" className="w-full py-2.5 rounded-xl">
            Return to Homepage
          </Button>
        </div>
      </main>
    );
  }

  if (status === "loading" || !summary) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-20 text-center text-slate-400">
        Loading admin console...
      </main>
    );
  }

  const pendingListingsTotal = pendingHotels.length + pendingVenues.length + pendingDrivers.length + pendingTechnicians.length;
  const analytics = summary.platform_analytics;

  const tabIcons: Record<Tab, React.ComponentType<{ size?: number; className?: string }>> = {
    summary: IconSparkles,
    properties: IconHome,
    listings: IconBuilding,
    verifications: IconShieldCheck,
    kyc: IconShield,
    reports: IconAlertCircle,
    disputes: IconLock,
    welfare: IconGraduationCap,
    sos: IconAlertCircle,
    users: IconUsers,
    greetings: IconSparkles,
    faqs: IconMapPin,
  };

  const tabs: { key: Tab; label: string; count?: number; isUrgent?: boolean }[] = [
    { key: "summary", label: t("tabSummary") },
    { key: "properties", label: t("tabPropertyListings"), count: pendingProperties.length },
    { key: "listings", label: t("tabListings"), count: pendingListingsTotal },
    { key: "verifications", label: t("tabVerifications"), count: verifications.length },
    { key: "kyc", label: t("tabKyc"), count: kycReviews.length },
    { key: "reports", label: t("tabReports"), count: reports.length, isUrgent: reports.length > 0 },
    { key: "disputes", label: t("tabDisputes"), count: disputes.length + serviceDisputes.length, isUrgent: disputes.length + serviceDisputes.length > 0 },
    { key: "welfare", label: t("tabWelfareAlerts"), count: welfareAlerts.filter((w) => !w.resolved_at).length, isUrgent: welfareAlerts.filter((w) => !w.resolved_at).length > 0 },
    { key: "sos", label: t("tabSos"), count: sosRides.length, isUrgent: sosRides.length > 0 },
    { key: "users", label: t("tabUsers"), count: summary.flagged_users_count ?? 0, isUrgent: (summary.flagged_users_count ?? 0) > 0 },
    { key: "greetings", label: t("tabGreetings") || "Celebratory Messages" },
    { key: "faqs", label: t("tabFaqs") },
  ];

  type TabGroup = {
    title: string;
    items: {
      key: Tab;
      label: string;
      count?: number;
      isUrgent?: boolean;
    }[];
  };

  const tabGroups: TabGroup[] = [
    {
      title: t("groupSystem"),
      items: [
        { key: "summary", label: t("tabSummary") },
        { key: "greetings", label: t("tabGreetings") || "Celebratory Messages" },
        { key: "faqs", label: t("tabFaqs") },
      ],
    },
    {
      title: t("groupApprovals"),
      items: [
        { key: "properties", label: t("tabPropertyListings"), count: pendingProperties.length },
        { key: "listings", label: t("tabListings"), count: pendingListingsTotal },
        { key: "verifications", label: t("tabVerifications"), count: verifications.length },
        { key: "kyc", label: t("tabKyc"), count: kycReviews.length },
      ],
    },
    {
      title: t("groupTrust"),
      items: [
        { key: "reports", label: t("tabReports"), count: reports.length, isUrgent: reports.length > 0 },
        { key: "disputes", label: t("tabDisputes"), count: disputes.length + serviceDisputes.length, isUrgent: disputes.length + serviceDisputes.length > 0 },
        { key: "welfare", label: t("tabWelfareAlerts"), count: welfareAlerts.filter((w) => !w.resolved_at).length, isUrgent: welfareAlerts.filter((w) => !w.resolved_at).length > 0 },
        { key: "sos", label: t("tabSos"), count: sosRides.length, isUrgent: sosRides.length > 0 },
        { key: "users", label: t("tabUsers"), count: summary.flagged_users_count ?? 0, isUrgent: (summary.flagged_users_count ?? 0) > 0 },
      ],
    },
  ];

  const totalPendingActionCount =
    pendingProperties.length +
    pendingListingsTotal +
    verifications.length +
    kycReviews.length +
    reports.length +
    disputes.length +
    serviceDisputes.length +
    welfareAlerts.filter((w) => !w.resolved_at).length +
    sosRides.length +
    (summary.flagged_users_count ?? 0);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-10">
      <PageHeader
        title={t("title")}
        subtitle="Manage KYC audits, title verification queues, content moderation and escrow dispute cases."
        action={
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Live System State
            </span>
          </div>
        }
      />

      {/* Mobile/tablet: modern categorized horizontal queue tabs with badges and quick refresh */}
      <div className="lg:hidden mb-6 space-y-3">
        <div className="flex items-center justify-between bg-white border border-slate-200/90 rounded-2xl p-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-black shadow-xs">
              <IconShield size={16} />
            </div>
            <div>
              <p className="text-xs font-black text-slate-900 leading-tight">{t("title")}</p>
              <p className="text-[10px] text-slate-500 font-medium">
                {totalPendingActionCount > 0 ? `${totalPendingActionCount} ${t("totalPending")}` : t("allClear")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors disabled:opacity-50"
          >
            <IconRefresh size={13} className={isRefreshing ? "animate-spin text-amber-600" : "text-slate-600"} />
            <span className="text-[11px]">{isRefreshing ? t("refreshing") : t("refresh")}</span>
          </button>
        </div>

        {/* Scrollable pill tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
          {tabs.map((tabItem) => {
            const Icon = tabIcons[tabItem.key];
            const isActive = tab === tabItem.key;
            return (
              <button
                key={tabItem.key}
                onClick={() => setTab(tabItem.key)}
                className={`whitespace-nowrap px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-150 flex items-center gap-2 shrink-0 ${
                  isActive
                    ? "bg-slate-900 text-white shadow-md shadow-slate-900/20"
                    : "bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200/90"
                }`}
              >
                <Icon size={14} className={isActive ? "text-amber-400" : "text-slate-400"} />
                <span>{tabItem.label}</span>
                {tabItem.count !== undefined && tabItem.count > 0 && (
                  <span
                    className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                      isActive
                        ? "bg-amber-400 text-slate-950"
                        : tabItem.isUrgent
                        ? "bg-rose-100 text-rose-800"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {tabItem.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg:flex lg:gap-8 lg:items-start">
        {/* Desktop: persistent dark modern sidebar navigation */}
        <aside className="hidden lg:block w-72 xl:w-80 shrink-0 sticky top-24 self-start">
          <div className="bg-slate-950 border border-slate-800/90 rounded-3xl p-3.5 shadow-2xl shadow-slate-950/60 flex flex-col gap-4 text-slate-300">
            
            {/* Top Admin Identity & Status Card */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/90 border border-slate-800/80 text-white shadow-inner relative overflow-hidden">
              {/* Subtle background glow */}
              <div className="absolute -top-10 -right-10 w-28 h-28 bg-amber-500/15 rounded-full blur-2xl pointer-events-none" />
              
              <div className="flex items-center gap-3 relative z-10">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center font-black shadow-md shadow-amber-500/25 shrink-0">
                  <IconShield size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black tracking-tight text-white truncate">
                      {t("title")}
                    </p>
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-700/60 px-2 py-0.5 rounded-full shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Live
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    Central Trust &amp; Ops
                  </p>
                </div>
              </div>

              {/* Action items banner inside the card */}
              <div className="mt-3 pt-3 border-t border-slate-800/90 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-medium">
                  {t("totalPending")}
                </span>
                {totalPendingActionCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 shadow-sm animate-pulse">
                    <span>{totalPendingActionCount}</span>
                    <span className="text-[9px] uppercase font-bold tracking-wider">tasks</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                    <IconCheckCircle size={12} />
                    <span>{t("allClear")}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Nav Groups */}
            <nav className="flex flex-col gap-4">
              {tabGroups.map((group) => (
                <div key={group.title} className="space-y-1">
                  <div className="px-3 py-1 flex items-center justify-between">
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                      {group.title}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {group.items.map((tabItem) => {
                      const Icon = tabIcons[tabItem.key];
                      const isActive = tab === tabItem.key;
                      const hasCount = tabItem.count !== undefined && tabItem.count > 0;
                      
                      return (
                        <button
                          key={tabItem.key}
                          onClick={() => setTab(tabItem.key)}
                          className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-xs font-bold transition-all duration-150 text-left ${
                            isActive
                              ? "bg-slate-850 text-white border border-slate-700/70 shadow-lg shadow-black/30"
                              : "text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent"
                          }`}
                        >
                          {/* Left active accent bar */}
                          {isActive && (
                            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-amber-400" />
                          )}

                          {/* Icon wrapper */}
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                              isActive
                                ? "bg-amber-400/15 text-amber-300"
                                : "bg-slate-900 text-slate-400 group-hover:bg-slate-800 group-hover:text-slate-200"
                            }`}
                          >
                            <Icon size={16} />
                          </div>

                          {/* Label */}
                          <span className="flex-1 truncate tracking-tight">{tabItem.label}</span>

                          {/* Count badge */}
                          {hasCount && (
                            <span
                              className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 transition-colors ${
                                isActive
                                  ? "bg-amber-400 text-slate-950 font-black"
                                  : tabItem.isUrgent
                                  ? "bg-rose-950/80 text-rose-300 border border-rose-800/80"
                                  : "bg-amber-950/80 text-amber-300 border border-amber-800/80"
                              }`}
                            >
                              {tabItem.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            {/* Sidebar Divider & Footer Utilities */}
            <div className="pt-2 border-t border-slate-850 flex flex-col gap-2">
              {/* Quick Sync Button */}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-850 active:bg-slate-800 text-slate-300 hover:text-white border border-slate-800/90 transition-all disabled:opacity-50"
              >
                <IconRefresh size={14} className={isRefreshing ? "animate-spin text-amber-400" : "text-slate-400"} />
                <span>{isRefreshing ? t("refreshing") : t("refresh")}</span>
              </button>

              {/* Quick Navigation Links */}
              <div className="flex items-center gap-1.5 pt-1">
                <a
                  href="http://127.0.0.1:8000/admin/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-bold text-slate-400 hover:text-amber-300 hover:bg-slate-900 transition-colors"
                >
                  <span>{t("djangoAdmin")}</span>
                  <IconArrowUpRight size={12} className="text-slate-500" />
                </a>
                <span className="text-slate-800">|</span>
                <Link
                  href="/"
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-bold text-slate-400 hover:text-amber-300 hover:bg-slate-900 transition-colors"
                >
                  <span>{t("publicPortal")}</span>
                  <IconChevronRight size={12} className="text-slate-500" />
                </Link>
              </div>

              {/* Security environment footnote */}
              <div className="text-[10px] text-center text-slate-500 font-medium pt-1">
                Oaziland Core • Platform Admin
              </div>
            </div>

          </div>
        </aside>

        {/* Content area */}
        <div className="flex-1 min-w-0">

      {/* ================= TAB: SUMMARY & PLATFORM-WIDE ANALYTICS ================= */}
      {tab === "summary" && (
        <div className="space-y-8 animate-rise-in">
          {/* Financial Escrow & Platform Volume Cards */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-3 flex items-center gap-1.5">
              <IconLock size={14} />
              <span>Financial Escrow &amp; Commission Volume (§2.8 &amp; §8.4)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 mb-1">{t("totalEscrowVolume")}</p>
                <p className="text-2xl font-extrabold text-slate-900">
                  {analytics ? Number(analytics.escrow_volume_xaf).toLocaleString() : "0"} <span className="text-xs font-medium text-slate-400">XAF</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-1">All bookings processed</p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 mb-1">{t("escrowHeld")}</p>
                <p className="text-2xl font-extrabold text-amber-600">
                  {analytics ? Number(analytics.escrow_held_xaf).toLocaleString() : "0"} <span className="text-xs font-medium text-slate-400">XAF</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-1">Active hold awaiting completion</p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 mb-1">{t("escrowReleased")}</p>
                <p className="text-2xl font-extrabold text-emerald-600">
                  {analytics ? Number(analytics.escrow_released_xaf).toLocaleString() : "0"} <span className="text-xs font-medium text-slate-400">XAF</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-1">Disbursed to property owners</p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 mb-1">{t("platformRevenue")}</p>
                <p className="text-2xl font-extrabold text-indigo-600">
                  {analytics ? Number(analytics.platform_revenue_xaf).toLocaleString() : "0"} <span className="text-xs font-medium text-slate-400">XAF</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-1">Retained fee revenue</p>
              </div>
            </div>
          </div>

          {/* Operational Metrics & Growth Cards */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
              <IconBuilding size={14} />
              <span>Platform Inventory &amp; Network Scale</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[11px] text-slate-500 font-semibold">{t("registeredUsers")}</p>
                <p className="text-xl font-bold text-slate-900 mt-1">{analytics?.total_users || 0}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[11px] text-slate-500 font-semibold">{t("activeProperties")}</p>
                <p className="text-xl font-bold text-slate-900 mt-1">{analytics?.active_listings_count || 0}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[11px] text-slate-500 font-semibold">{t("totalBookings")}</p>
                <p className="text-xl font-bold text-slate-900 mt-1">{analytics?.total_bookings_count || 0}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[11px] text-slate-500 font-semibold">{t("licensedAgents")}</p>
                <p className="text-xl font-bold text-slate-900 mt-1">{analytics?.total_agents || 0}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[11px] text-slate-500 font-semibold">{t("registeredLandlords")}</p>
                <p className="text-xl font-bold text-slate-900 mt-1">{analytics?.total_landlords || 0}</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[11px] text-slate-500 font-semibold">{t("vettedDrivers")}</p>
                <p className="text-xl font-bold text-slate-900 mt-1">{analytics?.total_drivers || 0}</p>
              </div>
            </div>
          </div>

          {/* Pending Queue Summary Cards */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-600 mb-3 flex items-center gap-1.5">
              <IconAlertCircle size={14} />
              <span>Pending Action Queues (§8.4)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase">{t("pendingPropertyListings")}</span>
                    <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      {pendingProperties.length}
                    </span>
                  </div>
                  <p className="text-3xl font-extrabold text-slate-900">{pendingProperties.length}</p>
                  <p className="text-xs text-slate-400 mt-1">Houses, land &amp; apartments awaiting approval</p>
                </div>
                <button onClick={() => setTab("properties")} className="mt-4 text-xs font-bold text-amber-600 hover:text-amber-700 text-left">
                  Review listings &rarr;
                </button>
              </div>

              <div className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase">{t("openDisputes")}</span>
                    <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                      {disputes.length}
                    </span>
                  </div>
                  <p className="text-3xl font-extrabold text-slate-900">{disputes.length}</p>
                  <p className="text-xs text-slate-400 mt-1">Active escrow payment arbitrations</p>
                </div>
                <button onClick={() => setTab("disputes")} className="mt-4 text-xs font-bold text-amber-600 hover:text-amber-700 text-left">
                  Manage escrow arbitration &rarr;
                </button>
              </div>

              <div className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase">{t("openWelfareAlerts")}</span>
                    <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                      {welfareAlerts.filter((w) => !w.resolved_at).length}
                    </span>
                  </div>
                  <p className="text-3xl font-extrabold text-slate-900">
                    {welfareAlerts.filter((w) => !w.resolved_at).length}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Campus student hostel welfare escalations</p>
                </div>
                <button onClick={() => setTab("welfare")} className="mt-4 text-xs font-bold text-amber-600 hover:text-amber-700 text-left">
                  Review welfare alerts &rarr;
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB: PROPERTY LISTING MODERATION QUEUE ================= */}
      {tab === "properties" && (
        <div className="space-y-4 animate-rise-in">
          {pendingProperties.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">All real estate property listings are published or audited.</p>
            </div>
          ) : (
            pendingProperties.map((p) => {
              const photo = p.photos?.find((ph) => ph.is_primary) || p.photos?.[0];
              return (
                <div
                  key={p.id}
                  className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-5"
                >
                  <div className="flex items-center gap-4">
                    {photo ? (
                      <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                        <img src={photo.url} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 text-xs shrink-0">
                        No photo
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="navy">{p.property_asset.type}</Badge>
                        <Badge variant="gold">{p.listing_type}</Badge>
                        <span className="text-xs text-slate-400 font-medium">{p.lister_role}</span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm">
                        {p.property_asset.quarter_name} — {Number(p.price_xaf).toLocaleString()} XAF
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                        {p.property_asset.description || "No description provided"}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">Listed by {p.lister_display_name}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <button
                      onClick={() => handleApproveProperty(p.id)}
                      className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shadow-sm"
                    >
                      Approve &amp; Publish
                    </button>
                    <button
                      onClick={() => handleRejectProperty(p.id)}
                      className="flex-1 md:flex-none bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shadow-sm"
                    >
                      {t("reject")}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ================= TAB: HOSPITALITY & DRIVERS ================= */}
      {tab === "listings" && (
        <div className="space-y-4 animate-rise-in">
          {pendingListingsTotal === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">All hotels, event venues, drivers &amp; technicians are verified.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingHotels.map((h) => (
                <div
                  key={h.id}
                  className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex items-center justify-between flex-wrap gap-3"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md mb-1 inline-block">
                      Hotel Review
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">{h.quarter_name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {h.star_rating ? `${h.star_rating} Stars • ` : ""}
                      {h.room_types.length} Room Type(s)
                    </p>
                  </div>
                  <button
                    onClick={() => handleVerifyHotel(h.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    Verify Hotel
                  </button>
                </div>
              ))}

              {pendingVenues.map((v) => (
                <div
                  key={v.id}
                  className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex items-center justify-between flex-wrap gap-3"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-pink-700 bg-pink-50 px-2 py-0.5 rounded-md mb-1 inline-block">
                      Event Venue Review
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">
                      {v.spaces[0]?.space_name || "Event Venue"} — {v.quarter_name}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">{v.spaces.length} Space(s)</p>
                  </div>
                  <button
                    onClick={() => handleVerifyVenue(v.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    Verify Venue
                  </button>
                </div>
              ))}

              {pendingDrivers.map((d) => (
                <div
                  key={d.id}
                  className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex items-center justify-between flex-wrap gap-3"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-orange-700 bg-orange-50 px-2 py-0.5 rounded-md mb-1 inline-block">
                      OaziGo Driver Review
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">{d.user_name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      License: {d.license_number} &bull; {d.vehicles.length} Vehicle(s)
                    </p>
                  </div>
                  <button
                    onClick={() => handleVerifyDriver(d.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    Verify Driver
                  </button>
                </div>
              ))}

              {pendingTechnicians.map((tech) => (
                <div
                  key={tech.id}
                  className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex items-center justify-between flex-wrap gap-3"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md mb-1 inline-block">
                      {t("technicianReview")}
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">{tech.user_name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t("specialtiesLabel")}: {tech.specialties.map((s) => taskln.category(s)).join(", ") || t("noneLabel")}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {(tech.credential_urls || []).length === 0 ? (
                        <span className="text-xs text-red-600">{t("noCredentials")}</span>
                      ) : (
                        tech.credential_urls.map((url, index) => (
                          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-700 underline">
                            {t("credentialN", { n: index + 1 })}
                          </a>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReviewTechnician(tech.id, "reject")}
                      className="bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                    >
                      {t("rejectTechnician")}
                    </button>
                    <button
                      onClick={() => handleVerifyTechnician(tech.id)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm cursor-pointer"
                    >
                      {t("verifyTechnician")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {verifiedTechnicians.length > 0 && (
            <div className="space-y-3 pt-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">{t("verifiedTechniciansTitle")}</h3>
              {verifiedTechnicians.map((tech) => (
                <div key={tech.id} className="border border-slate-200/80 rounded-2xl p-4 bg-white shadow-sm flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">{tech.user_name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {tech.specialties.map((s) => taskln.category(s)).join(", ") || t("noneLabel")} &bull; ★ {tech.avg_rating}
                    </p>
                  </div>
                  <button
                    onClick={() => handleReviewTechnician(tech.id, "revoke")}
                    className="bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    {t("revokeTechnician")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= TAB: VERIFICATION REQUESTS (KYC & TITLE DEEDS) ================= */}
      {tab === "verifications" && (
        <div className="space-y-4 animate-rise-in">
          {verifications.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">All identity &amp; title deed requests have been audited.</p>
            </div>
          ) : (
            verifications.map((v) => (
              <div
                key={v.id}
                className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex items-center justify-between flex-wrap gap-4"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-slate-900 text-sm">{v.requester_name}</span>
                    <Badge variant="navy">{v.request_type.replaceAll("_", " ")}</Badge>
                  </div>
                  {v.supporting_document_url && (
                    <a
                      href={v.supporting_document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-amber-600 hover:underline flex items-center gap-1 font-medium mt-1"
                    >
                      <span>View Uploaded Title / ID Document</span>
                      <span>&nearr;</span>
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApproveVerification(v.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    {t("approve")}
                  </button>
                  <button
                    onClick={() => handleRejectVerification(v.id)}
                    className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    {t("reject")}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ================= TAB: KYC REVIEW ================= */}
      {tab === "kyc" && (
        <div className="space-y-4 animate-rise-in">
          {kycReviews.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">No pending identity (KYC) submissions to review.</p>
            </div>
          ) : (
            kycReviews.map((k) => (
              <div
                key={k.id}
                className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-slate-900 text-sm">{k.legal_full_name}</span>
                    <span className="text-xs text-slate-400 font-medium">@{k.username}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    ID: {k.national_id_number} &bull; DOB: {k.date_of_birth} &bull; {k.residential_address}
                  </p>
                  <div className="flex gap-3 mt-1.5">
                    {k.id_document_front_image_url && (
                      <a href={k.id_document_front_image_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-600 hover:underline font-medium">
                        View ID Front &nearr;
                      </a>
                    )}
                    {k.id_document_back_image_url && (
                      <a href={k.id_document_back_image_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-600 hover:underline font-medium">
                        View ID Back &nearr;
                      </a>
                    )}
                    {k.selfie_image_url && (
                      <a href={k.selfie_image_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-600 hover:underline font-medium">
                        View Selfie &nearr;
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApproveKyc(k.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    {t("approve")}
                  </button>
                  <button
                    onClick={() => handleRejectKyc(k.id)}
                    className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    {t("reject")}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ================= TAB: CONTENT REPORTS & STRIKES ================= */}
      {tab === "reports" && (
        <div className="space-y-4 animate-rise-in">
          {reports.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">No community flags or scam reports currently open.</p>
            </div>
          ) : (
            reports.map((r) => (
              <div
                key={r.id}
                className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex items-center justify-between flex-wrap gap-4"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant="clay">{r.reason}</Badge>
                    <span className="text-xs text-slate-400 font-medium">
                      Reported by {r.reported_by_name}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed mb-2">{r.notes}</p>
                </div>
                <div>
                  <button
                    onClick={() => handleResolveReport(r.id)}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors"
                  >
                    Take Action &amp; Resolve
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ================= TAB: ESCROW DISPUTE CASES ================= */}
      {tab === "disputes" && (
        <div className="space-y-4 animate-rise-in">
          {disputes.length === 0 && serviceDisputes.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">Zero pending escrow payment disputes.</p>
            </div>
          ) : (
            disputes.map((d) => (
              <div
                key={d.id}
                className="border border-slate-200/80 rounded-2xl p-6 bg-white shadow-sm flex flex-col gap-4"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">Dispute #{d.id.slice(0, 8)}</span>
                    <Badge variant="gold">{d.status}</Badge>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  {d.reason}
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setActiveDisputeChatId(activeDisputeChatId === d.id ? null : d.id)}
                    className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    <span>💬 {activeDisputeChatId === d.id ? "Hide Mediation Chat" : "Open Mediation Chat"}</span>
                  </button>
                  {d.status === "OPEN" && (
                    <button
                      onClick={() => handleRespondDispute(d.id)}
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    onClick={() => handleResolveDispute(d.id, "RELEASE")}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    Release to Landlord
                  </button>
                  <button
                    onClick={() => handleResolveDispute(d.id, "REFUND")}
                    className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    Refund Tenant
                  </button>
                </div>

                {activeDisputeChatId === d.id && (
                  <DisputeChat disputeId={d.id} myUserId={null} />
                )}
              </div>
            ))
          )}

          {serviceDisputes.length > 0 && (
            <>
              <h3 className="pt-2 text-sm font-black uppercase tracking-widest text-slate-500">{t("jobDisputesTitle")}</h3>
              {serviceDisputes.map((job) => (
                <div key={job.id} className="border border-slate-200/80 rounded-2xl p-6 bg-white shadow-sm flex flex-col gap-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{taskln.category(job.category)} #{job.id.slice(0, 8)}</span>
                      <Badge variant="clay">{job.status}</Badge>
                    </div>
                    {job.quoted_amount_xaf && (
                      <span className="text-xs font-bold text-slate-600">
                        {t("jobDisputeQuote")}: {Number(job.quoted_amount_xaf).toLocaleString()} XAF
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-500">
                    {t("jobDisputeRequester")}: <span className="font-semibold text-slate-800">{job.requester_name}</span>
                    {" · "}
                    {t("jobDisputeTechnician")}: <span className="font-semibold text-slate-800">{job.technician_name || "—"}</span>
                  </p>
                  <p className="text-xs text-slate-600">{job.description}</p>
                  <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100">{job.dispute_reason}</p>
                  {job.escrow_funded && (
                    <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl p-3">{t("jobDisputeEscrowHeld")}</p>
                  )}

                  {job.messages.length > 0 && (
                    <div className="rounded-xl border border-slate-100 p-3 space-y-1 max-h-40 overflow-y-auto">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("jobDisputeChat")}</p>
                      {job.messages.map((m) => (
                        <p key={m.id} className="text-xs text-slate-600"><span className="font-bold text-slate-800">{m.sender_name}:</span> {m.text}</p>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                    {job.technician && (
                      <button
                        onClick={() => handleResolveServiceDispute(job.id, "RESUME")}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                      >
                        {t("jobDisputeResume")}
                      </button>
                    )}
                    <button
                      onClick={() => handleResolveServiceDispute(job.id, "REASSIGN")}
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                    >
                      {t("jobDisputeReassign")}
                    </button>
                    <button
                      onClick={() => handleResolveServiceDispute(job.id, "CANCEL")}
                      className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                    >
                      {t("jobDisputeCancel")}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ================= TAB: STUDENT WELFARE ALERTS QUEUE (§8.4) ================= */}
      {tab === "welfare" && (
        <div className="space-y-4 animate-rise-in">
          {welfareAlerts.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">Zero open student welfare alerts across Cameroonian university campuses.</p>
            </div>
          ) : (
            welfareAlerts.map((w) => (
              <div
                key={w.id}
                className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <Badge variant="clay">{w.reason.replaceAll("_", " ")}</Badge>
                    <span className="font-bold text-slate-900 text-sm">Student: {w.student_name || w.student_username}</span>
                    <span className="text-xs text-slate-500">({w.student_phone})</span>
                    {w.resolved_at ? (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                        Resolved
                      </span>
                    ) : (
                      <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                        Active Alert
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed mb-1">{w.details || "No details provided"}</p>
                  <p className="text-[11px] text-slate-400">
                    Raised: {new Date(w.created_at).toLocaleString()}
                    {w.raised_by_name ? ` by ${w.raised_by_name}` : ""}
                  </p>
                </div>

                {!w.resolved_at && (
                  <button
                    onClick={() => handleResolveWelfare(w.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors whitespace-nowrap shadow-sm"
                  >
                    {t("markResolved")}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "sos" && (
        <div className="space-y-4 animate-rise-in">
          {sosRides.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">{t("sosEmpty")}</p>
            </div>
          ) : (
            sosRides.map((ride) => (
              <div key={ride.id} className="border border-red-200 rounded-2xl p-5 bg-white shadow-sm flex flex-col md:flex-row items-start justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="clay">{t("sosBadge")}</Badge>
                    <span className="font-bold text-slate-900 text-sm">
                      {ride.raised_by?.name ?? "—"} <span className="font-normal text-slate-500">({ride.raised_by?.phone})</span>
                    </span>
                    <span className="text-[11px] text-slate-400">{new Date(ride.sos_raised_at).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-slate-700">{ride.pickup_description} → {ride.dropoff_description} · {ride.status.replace("_", " ")}</p>
                  {ride.sos_note && <p className="text-xs text-slate-800 font-medium">“{ride.sos_note}”</p>}
                  <p className="text-[11px] text-slate-500">
                    {t("sosRider")}: {ride.rider?.name} ({ride.rider?.phone})
                    {ride.driver && <> · {t("sosDriver")}: {ride.driver.name} ({ride.driver.phone})</>}
                    {ride.vehicle_details && <> · {ride.vehicle_details.make} {ride.vehicle_details.model}, {ride.vehicle_details.plate_number}</>}
                  </p>
                  {ride.raised_by_contact && (
                    <p className="text-[11px] text-slate-500">{t("sosContact")}: {ride.raised_by_contact.name} ({ride.raised_by_contact.phone})</p>
                  )}
                  {ride.sos_latitude && ride.sos_longitude ? (
                    <a
                      href={`https://www.google.com/maps?q=${ride.sos_latitude},${ride.sos_longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-[11px] font-bold text-amber-700 underline"
                    >
                      {t("sosOpenMap")}
                    </a>
                  ) : (
                    <p className="text-[11px] text-slate-400">{t("sosNoLocation")}</p>
                  )}
                </div>
                <button
                  onClick={() => handleResolveSos(ride.id)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors whitespace-nowrap shadow-sm"
                >
                  {t("markResolved")}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ================= TAB: USER MANAGEMENT & TRUST AUDIT (§2.7 & §8.4) ================= */}
      {tab === "users" && (
        <div className="space-y-4 animate-rise-in">
          <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-slate-200/80">
            <div className="flex gap-2 flex-wrap">
              {["ALL", "ACTIVE", "SUSPENDED", "BANNED"].map((f) => (
                <button
                  key={f}
                  onClick={() => setUserStatusFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    userStatusFilter === f
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {usersLoading ? "Loading…" : `${usersCount} Users Total`}
            </span>
          </div>

          {/* Role filter — lets the admin manage every distinct type of
              user on the platform (renter/buyer, landlord, agent,
              agency, student, technician, driver, admin), not just a
              flat undifferentiated list. */}
          <div className="flex gap-2 flex-wrap pb-2">
            {["ALL", "REGULAR", "LANDLORD", "AGENT", "AGENCY", "STUDENT", "TECHNICIAN", "DRIVER", "ADMIN"].map((r) => (
              <button
                key={r}
                onClick={() => setUserRoleFilter(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                  userRoleFilter === r
                    ? "bg-amber-500 text-slate-950 border-amber-500"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {r === "ALL" ? "All Roles" : r.charAt(0) + r.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {usersLoading ? (
              <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
                <p className="text-sm font-semibold text-slate-600">Loading users…</p>
              </div>
            ) : users.length === 0 ? (
              <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
                <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              </div>
            ) : (
              users.map((u) => {
              const roleBadges: { label: string; value: AssignableRole; on: boolean }[] = [
                { label: "Landlord", value: "landlord", on: u.is_landlord },
                { label: "Agent", value: "agent", on: u.is_agent },
                { label: "Agency", value: "agency", on: u.is_agency },
                { label: "Student", value: "student", on: u.is_student },
                { label: "Technician", value: "technician", on: u.is_technician },
                { label: "Driver", value: "driver", on: u.is_driver },
                { label: "Admin", value: "admin", on: u.is_admin },
              ];
              const activeRoleBadges = roleBadges.filter((r) => r.on);
              const availableRoles = ASSIGNABLE_ROLES.filter(
                (r) => !roleBadges.find((b) => b.value === r.value)?.on
              );
              return (
              <div
                key={u.id}
                className="border border-slate-200/80 rounded-2xl p-4 bg-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-slate-900 text-sm">{u.username}</span>
                    <span className="text-xs text-slate-500">({u.phone})</span>
                    {activeRoleBadges.length === 0 ? (
                      <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-full">
                        Regular User
                      </span>
                    ) : (
                      activeRoleBadges.map((r) => (
                        <span
                          key={r.label}
                          className="text-[10px] bg-blue-50 text-blue-800 border border-blue-200 font-bold pl-2 pr-1 py-0.5 rounded-full flex items-center gap-1"
                        >
                          {r.label}
                          <button
                            type="button"
                            onClick={() => handleRemoveRole(u.id, r.value)}
                            title={`Remove ${r.label} role`}
                            className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-blue-200 text-blue-700 leading-none"
                          >
                            &times;
                          </button>
                        </span>
                      ))
                    )}
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        u.account_status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-800"
                          : u.account_status === "SUSPENDED"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {u.account_status}
                    </span>
                    {u.strikes_count > 0 && (
                      <span className="text-[10px] bg-rose-50 border border-rose-200 text-rose-700 font-extrabold px-2 py-0.5 rounded-full">
                        {t("strikeCount", { count: u.strikes_count })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Joined: {new Date(u.date_joined).toLocaleDateString()}
                    {u.suspended_until ? ` &bull; Suspended until: ${new Date(u.suspended_until).toLocaleDateString()}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => handleToggleSuspendUser(u.id, u.account_status)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${
                      u.account_status === "ACTIVE"
                        ? "bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
                        : "bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                    }`}
                  >
                    {u.account_status === "ACTIVE" ? t("suspendAccount") : t("reinstateAccount")}
                  </button>

                  <button
                    onClick={() => handleIssueUserStrike(u.id)}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 transition-colors"
                  >
                    {t("issueWarning")}
                  </button>

                  {/* Multi-role assignment — a user can hold several
                      roles at once (e.g. Agent + Landlord), matching
                      how roles are actually stored as independent
                      profile tables, not a single exclusive field. */}
                  <div className="relative">
                    <button
                      onClick={() => setRoleManagerUserId(roleManagerUserId === u.id ? null : u.id)}
                      disabled={roleActionBusy}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                    >
                      + Add Role
                    </button>
                    {roleManagerUserId === u.id && (
                      <div className="absolute right-0 z-10 mt-1.5 w-44 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5">
                        {availableRoles.length === 0 ? (
                          <p className="text-[11px] text-slate-400 px-2 py-1.5">All roles already assigned.</p>
                        ) : (
                          availableRoles.map((r) => (
                            <button
                              key={r.value}
                              onClick={() => {
                                handleAssignRole(u.id, r.value);
                                setRoleManagerUserId(null);
                              }}
                              className="w-full text-left text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700"
                            >
                              {r.label}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              );
              })
            )}
          </div>

          {/* Real server-side pagination — the users queue is never
              silently capped at one page's worth of accounts. */}
          {usersCount > 0 && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={() => loadUsers(usersPage - 1)}
                disabled={usersPage <= 1 || usersLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-xs text-slate-500 font-medium">Page {usersPage}</span>
              <button
                onClick={() => loadUsers(usersPage + 1)}
                disabled={!usersHasNext || usersLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB: FAQ MANAGEMENT ================= */}
      {tab === "faqs" && <AdminFaqManager />}

      {/* ================= TAB: CELEBRATORY GREETINGS SETTINGS ================= */}
      {tab === "greetings" && (
        <div className="space-y-6 animate-rise-in max-w-3xl">
          <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs">
            <h3 className="font-bold text-slate-900 text-lg mb-1">
              Automated Celebratory Greetings (Happy Birthday &amp; New Month)
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              Configure and control platform automated greetings sent to active users. You can toggle each
              celebration ON or OFF and customize the wording. Supported placeholders: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-amber-600 font-mono text-[11px]">&#123;name&#125;</code> for the user&apos;s name and <code className="bg-slate-100 px-1.5 py-0.5 rounded text-amber-600 font-mono text-[11px]">&#123;month&#125;</code> for the month name.
            </p>

            {!greetingSettings ? (
              <p className="text-sm text-slate-400 py-6 text-center">Loading greeting configuration...</p>
            ) : (
              <form onSubmit={handleSaveGreetingSettings} className="space-y-8">
                {/* 1. Happy Birthday Section */}
                <div className="p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">🎂</span>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Happy Birthday Greetings</h4>
                        <p className="text-xs text-slate-500">Sent to active users on their birth date (from verified KYC).</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={greetingSettings.birthday_enabled}
                        onChange={(e) =>
                          setGreetingSettings({ ...greetingSettings, birthday_enabled: e.target.checked })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                      <span className="ml-2 text-xs font-bold text-slate-700">
                        {greetingSettings.birthday_enabled ? "Enabled" : "Disabled"}
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Birthday Notification Title
                    </label>
                    <input
                      type="text"
                      value={greetingSettings.birthday_title}
                      onChange={(e) =>
                        setGreetingSettings({ ...greetingSettings, birthday_title: e.target.value })
                      }
                      className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Birthday Message Template
                    </label>
                    <textarea
                      rows={3}
                      value={greetingSettings.birthday_message}
                      onChange={(e) =>
                        setGreetingSettings({ ...greetingSettings, birthday_message: e.target.value })
                      }
                      className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500"
                      required
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Preview: {greetingSettings.birthday_message.replace("{name}", "Sarah")}
                    </p>
                  </div>
                </div>

                {/* 2. Happy New Month Section */}
                <div className="p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">🗓️</span>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">Happy New Month Greetings</h4>
                        <p className="text-xs text-slate-500">Sent to all active users on the 1st of every month.</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={greetingSettings.new_month_enabled}
                        onChange={(e) =>
                          setGreetingSettings({ ...greetingSettings, new_month_enabled: e.target.checked })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                      <span className="ml-2 text-xs font-bold text-slate-700">
                        {greetingSettings.new_month_enabled ? "Enabled" : "Disabled"}
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      New Month Notification Title
                    </label>
                    <input
                      type="text"
                      value={greetingSettings.new_month_title}
                      onChange={(e) =>
                        setGreetingSettings({ ...greetingSettings, new_month_title: e.target.value })
                      }
                      className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      New Month Message Template
                    </label>
                    <textarea
                      rows={3}
                      value={greetingSettings.new_month_message}
                      onChange={(e) =>
                        setGreetingSettings({ ...greetingSettings, new_month_message: e.target.value })
                      }
                      className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500"
                      required
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Preview: {greetingSettings.new_month_message.replace("{name}", "Sarah").replace("{month}", "October")}
                    </p>
                  </div>
                </div>

                {/* 3. WhatsApp listing share message */}
                <div className="p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-4">
                  <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200/80">
                    <span className="text-2xl">💬</span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">WhatsApp Listing Share Message</h4>
                      <p className="text-xs text-slate-500">
                        Pre-filled text when someone taps Share on a listing card. Placeholders: {"{title}"}, {"{price}"}, {"{location}"}, {"{link}"}.
                      </p>
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    value={greetingSettings.listing_share_message}
                    onChange={(e) =>
                      setGreetingSettings({ ...greetingSettings, listing_share_message: e.target.value })
                    }
                    className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500"
                    required
                  />
                  <p className="text-[11px] text-slate-400">
                    Preview: {greetingSettings.listing_share_message
                      .replace("{title}", "house")
                      .replace("{price}", "150,000")
                      .replace("{location}", "Bonamoussadi")
                      .replace("{link}", "https://oaziland.com/en/listing/123")}
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button disabled={savingGreetings} size="lg">
                    {savingGreetings ? "Saving changes..." : "Save Greeting Settings"}
                  </Button>
                  {greetingSaveSuccess && (
                    <span className="text-xs text-emerald-700 font-bold animate-fade-in flex items-center gap-1">
                      <span>✓</span> Settings saved successfully!
                    </span>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      )}
        </div>
      </div>
    </main>
  );
}

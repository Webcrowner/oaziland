"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useTasklnLabels } from "@/lib/useTasklnLabels";
import { useAdminDialogs } from "@/components/admin/useAdminDialogs";
import AdminKycReviewCard from "@/components/admin/AdminKycReviewCard";
import DisputeSplitForm from "@/components/admin/DisputeSplitForm";
import DataAdminLink, { DataAdminAccess, dataAdminPath, openInDataAdmin } from "@/components/admin/DataAdminLink";
import { Link } from "@/i18n/navigation";
import {
  ApiStatusError,
  getAdminConsoleSummary,
  listAdminKycReviews,
  approveKyc,
  rejectKyc,
  listAdminContentReports,
  resolveContentReport,
  listAdminDisputeCases,
  respondToDispute,
  resolveDispute,
  listAdminWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  listAdminAuditLog,
  getAdminVisitorSummary,
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
  type AdminKycReviewItem,
  type AdminContentReport,
  type AdminDisputeCase,
  type AdminWithdrawal,
  type AdminAuditEntry,
  type AdminVisitorSummary,
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
import AdminSupportInbox from "@/components/admin/AdminSupportInbox";
import AdminPricingEditor from "@/components/admin/AdminPricingEditor";
import AdminContentBrowser from "@/components/admin/AdminContentBrowser";
import AdminAiFlagsQueue from "@/components/admin/AdminAiFlagsQueue";
import AdminAreaRequests from "@/components/admin/AdminAreaRequests";
import AdminPayments from "@/components/admin/AdminPayments";
import AdminVerificationQueue from "@/components/admin/AdminVerificationQueue";
import AdminPrivacyRequests from "@/components/admin/AdminPrivacyRequests";
import AdminAnalyticsPanel from "@/components/admin/AdminAnalyticsPanel";
import AdminCertificateDesigner from "@/components/admin/AdminCertificateDesigner";
import AdminCourseCreators from "@/components/admin/AdminCourseCreators";
import HostelRoomsManager from "@/components/HostelRoomsManager";
import AdminUserOverviewPanel from "@/components/admin/AdminUserOverviewPanel";
import MobileTabBar, { type MobileTabItem } from "@/components/MobileTabBar";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import {
  IconShield,
  IconShieldCheck,
  IconLock,
  IconUsers,
  IconAlertCircle,
  IconSparkles,
  IconBuilding,
  IconHome,
  IconGraduationCap,
  IconMapPin,
  IconCheckCircle,
  IconChevronRight,
  IconArrowUpRight,
  IconRefresh,
  IconCreditCard,
  IconMessageCircle,
  IconClock,
  IconEye,
  IconX,
} from "@/components/Icons";

function playSosAlertTone() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [880, 660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.18);
    });
  } catch {
    // Browser autoplay policy may block audio before user interaction.
  }
}

const TABS = [
  "summary",
  "properties",
  "listings",
  "verifications",
  "kyc",
  "reports",
  "content",
  "aiflags",
  "areas",
  "disputes",
  "withdrawals",
  "payments",
  "pricing",
  "support",
  "welfare",
  "sos",
  "users",
  "greetings",
  "faqs",
  "visitors",
  "privacy",
  "analytics",
  "rooms",
  "certificates",
  "trainers",
  "audit",
] as const;

type Tab = (typeof TABS)[number];

/** The tab named in the address bar (?tab=...), or null when there is none or it is not a real tab. */
function tabFromUrl(): Tab | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("tab");
  return value && (TABS as readonly string[]).includes(value) ? (value as Tab) : null;
}

/** A small country-code badge (flag emoji are not drawn on Windows, so a badge looks the same everywhere). */
function CountryBadge({ code }: { code: string }) {
  return (
    <span className="mr-1.5 inline-block min-w-[1.75rem] rounded bg-slate-100 px-1 py-0.5 text-center text-[10px] font-black tracking-wide text-slate-600">
      {/^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : "—"}
    </span>
  );
}

/** A ranked list with proportional bars, used for the visitor breakdowns. */
function VisitorBars({ rows, empty }: { rows: { key: string; label: React.ReactNode; value: number }[]; empty: string }) {
  if (rows.length === 0) return <p className="py-4 text-center text-xs text-slate-400">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-semibold text-slate-700">{row.label}</span>
            <span className="shrink-0 font-bold text-slate-900">{row.value.toLocaleString()}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.max(3, (row.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AdminConsolePage() {
  const t = useTranslations("AdminConsolePage");
  const locale = useLocale();
  const dialogs = useAdminDialogs();
  const taskln = useTasklnLabels();
  const [tab, setTabState] = useState<Tab>("summary");
  const [navOpen, setNavOpen] = useState(false);

  // Every tab has its own address (?tab=...), so a tab can be linked, bookmarked or reloaded, and the
  // browser's back/forward buttons move between tabs.
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    const current = url.searchParams.get("tab") ?? "summary";
    if (current === next) return;
    if (next === "summary") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.pushState({ adminTab: next }, "", url);
  }, []);

  useEffect(() => {
    const fromUrl = tabFromUrl();
    if (fromUrl) void Promise.resolve().then(() => setTabState(fromUrl));
    const onPop = () => setTabState(tabFromUrl() ?? "summary");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "notAdmin" | "error" | "ready">("loading");
  // Why the last load failed (for the error screen and the banner shown over an already-open console).
  const [loadProblem, setLoadProblem] = useState<{ rateLimited: boolean; retryAfter: number | null; partial: boolean } | null>(null);
  const [summary, setSummary] = useState<AdminConsoleSummary | null>(null);

  // A link to a full-access-only tab, opened by a limited admin, falls back to the overview.
  useEffect(() => {
    if (!summary || summary.is_super_admin) return;
    if (tab !== "pricing" && tab !== "audit") return;
    void Promise.resolve().then(() => {
      setTabState("summary");
      const url = new URL(window.location.href);
      url.searchParams.delete("tab");
      window.history.replaceState({ adminTab: "summary" }, "", url);
    });
  }, [summary, tab]);

  // Queues
  const [pendingProperties, setPendingProperties] = useState<Listing[]>([]);
  const [pendingHotels, setPendingHotels] = useState<Hotel[]>([]);
  const [pendingVenues, setPendingVenues] = useState<Venue[]>([]);
  const [pendingDrivers, setPendingDrivers] = useState<DriverProfileItem[]>([]);
  const [pendingTechnicians, setPendingTechnicians] = useState<TechnicianProfileItem[]>([]);
  const [verifiedTechnicians, setVerifiedTechnicians] = useState<TechnicianProfileItem[]>([]);
  const [kycReviews, setKycReviews] = useState<AdminKycReviewItem[]>([]);
  const [reports, setReports] = useState<AdminContentReport[]>([]);
  const [disputes, setDisputes] = useState<AdminDisputeCase[]>([]);
  const [serviceDisputes, setServiceDisputes] = useState<AdminServiceDisputeItem[]>([]);
  const [activeDisputeChatId, setActiveDisputeChatId] = useState<string | null>(null);
  const [splitDisputeId, setSplitDisputeId] = useState<string | null>(null);
  const [welfareAlerts, setWelfareAlerts] = useState<AdminWelfareAlert[]>([]);
  const [sosRides, setSosRides] = useState<AdminSosRide[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userStatusFilter, setUserStatusFilter] = useState<string>("ALL");
  const [userRoleFilter, setUserRoleFilter] = useState<string>("ALL");
  const [userSearchInput, setUserSearchInput] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [overviewUserId, setOverviewUserId] = useState<string | null>(null);
  const [usersPage, setUsersPage] = useState(1);
  const [usersCount, setUsersCount] = useState(0);
  const [usersHasNext, setUsersHasNext] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [roleManagerUserId, setRoleManagerUserId] = useState<string | null>(null);
  const [roleActionBusy, setRoleActionBusy] = useState(false);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [withdrawalFilter, setWithdrawalFilter] = useState<"PENDING" | "PAID_OUT" | "REJECTED">("PENDING");
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false);
  const [withdrawalBusyId, setWithdrawalBusyId] = useState<string | null>(null);

  // Visitor statistics
  const [visitorDays, setVisitorDays] = useState(7);
  const [visitorData, setVisitorData] = useState<AdminVisitorSummary | null>(null);
  const [visitorLoading, setVisitorLoading] = useState(false);
  const [visitorError, setVisitorError] = useState(false);

  // Audit log
  const [auditEntries, setAuditEntries] = useState<AdminAuditEntry[]>([]);
  const [auditCount, setAuditCount] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditHasNext, setAuditHasNext] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditOutcome, setAuditOutcome] = useState<"" | "failed" | "success">("");
  const [auditSince, setAuditSince] = useState("");
  const [auditUntil, setAuditUntil] = useState("");

  // Celebratory greetings settings (Birthday & Happy New Month)
  const [greetingSettings, setGreetingSettings] = useState<AdminGreetingSettings | null>(null);
  const [savingGreetings, setSavingGreetings] = useState(false);
  const [greetingSaveSuccess, setGreetingSaveSuccess] = useState(false);
  const [notifPermission, setNotifPermission] = useState<string>(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
  );
  const seenSosKeysRef = useRef<Set<string>>(new Set());

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  const notifyNewSosRides = useCallback(
    (incoming: AdminSosRide[]) => {
      let hasNew = false;
      for (const ride of incoming) {
        const key = `${ride.id}:${ride.sos_raised_at}`;
        if (!seenSosKeysRef.current.has(key)) {
          seenSosKeysRef.current.add(key);
          hasNew = true;
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            try {
              new Notification(`🆘 OaziGo SOS — ${ride.raised_by?.name ?? "Ride Alert"}`, {
                body: `${ride.pickup_description} → ${ride.dropoff_description}`,
                tag: key,
              });
            } catch {
              // Ignore notification errors in restricted contexts.
            }
          }
        }
      }
      if (hasNew) {
        playSosAlertTone();
      }
    },
    []
  );

  // Real server-side filtering + pagination for the Users queue —
  // account_status/role are sent to the API and paged with ?page=,
  // rather than only ever filtering whatever single page of users
  // happened to already be loaded client-side.
  const loadUsers = useCallback(
    async (page: number) => {
      if (!token) return;
      setUsersLoading(true);
      const statusParam = userStatusFilter === "ALL" ? undefined : userStatusFilter;
      const roleParam = userRoleFilter === "ALL" ? undefined : userRoleFilter.toLowerCase();
      try {
        const data = await listAdminUsers(token, statusParam, roleParam, page, userSearch || undefined);
        setUsers(data.results || []);
        setUsersCount(data.count || 0);
        setUsersHasNext(Boolean(data.next));
        setUsersPage(page);
      } catch {
        // Ignore transient user list error
      } finally {
        setUsersLoading(false);
      }
    },
    [token, userStatusFilter, userRoleFilter, userSearch]
  );

  useEffect(() => {
    void Promise.resolve().then(() => loadUsers(1));
  }, [loadUsers]);

  const loadWithdrawals = useCallback(async () => {
    if (!token) return;
    setWithdrawalsLoading(true);
    try {
      const data = await listAdminWithdrawals(withdrawalFilter, token);
      setWithdrawals(data.results || []);
    } catch {
      setWithdrawals([]);
    } finally {
      setWithdrawalsLoading(false);
    }
  }, [token, withdrawalFilter]);

  useEffect(() => {
    if (tab !== "withdrawals") return;
    void Promise.resolve().then(() => loadWithdrawals());
  }, [tab, loadWithdrawals]);

  const loadVisitors = useCallback(async () => {
    if (!token) return;
    setVisitorLoading(true);
    try {
      setVisitorData(await getAdminVisitorSummary(visitorDays, token));
      setVisitorError(false);
    } catch {
      setVisitorError(true);
    } finally {
      setVisitorLoading(false);
    }
  }, [token, visitorDays]);

  useEffect(() => {
    if (tab !== "visitors") return;
    void Promise.resolve().then(() => loadVisitors());
    const interval = setInterval(loadVisitors, 30000);
    return () => clearInterval(interval);
  }, [tab, loadVisitors]);

  const loadAudit = useCallback(
    async (page: number) => {
      if (!token) return;
      setAuditLoading(true);
      setAuditError(false);
      try {
        const data = await listAdminAuditLog(
          { q: auditQuery, outcome: auditOutcome, since: auditSince, until: auditUntil, page },
          token
        );
        setAuditEntries(data.results || []);
        setAuditCount(data.count || 0);
        setAuditHasNext(Boolean(data.next));
        setAuditPage(page);
      } catch {
        setAuditEntries([]);
        setAuditError(true);
      } finally {
        setAuditLoading(false);
      }
    },
    [token, auditQuery, auditOutcome, auditSince, auditUntil]
  );

  useEffect(() => {
    if (tab !== "audit") return;
    void Promise.resolve().then(() => loadAudit(1));
  }, [tab, loadAudit]);

  const loadAll = useCallback(async () => {
    if (!token) {
      setStatus("signedOut");
      return;
    }
    // Only the summary decides access: a 403 there means "not an admin". The other
    // lists may fail on their own (rate limit, server error); they keep their last
    // data and a banner says so, rather than the whole console turning into "Access Denied".
    let partial = false;
    const soft = <T,>(p: Promise<T>): Promise<T | undefined> =>
      p.catch(() => {
        partial = true;
        return undefined;
      });
    try {
      const [
        summaryData,
        propertiesData,
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
      ] = await Promise.all([
        getAdminConsoleSummary(token),
        soft(listAdminPendingPropertyListings(token)),
        soft(listAdminKycReviews(token)),
        soft(listAdminContentReports(token)),
        soft(listAdminDisputeCases(token)),
        soft(listHotelsForAdmin(token)),
        soft(listVenuesForAdmin(token)),
        soft(listDriversForAdmin(token)),
        soft(listTechniciansForAdmin(token)),
        soft(listAdminWelfareAlerts(token)),
        soft(getAdminGreetingSettings(token)),
        soft(listAdminServiceDisputes(token)),
        soft(listTechniciansForAdmin(token, "verified")),
        soft(listAdminSosRides(token)),
      ]);
      setSummary(summaryData);
      if (propertiesData) setPendingProperties(propertiesData.results || []);
      if (kycReviewsData) setKycReviews(kycReviewsData.results || []);
      if (reportsData) setReports(reportsData.results || []);
      if (disputesData) setDisputes(disputesData.results || []);
      if (hotelsData) setPendingHotels((hotelsData.results || []).filter((h) => !h.verified));
      if (venuesData) setPendingVenues((venuesData.results || []).filter((v) => !v.verified));
      if (driversData) setPendingDrivers(driversData.results || []);
      if (techniciansData) setPendingTechnicians(techniciansData.results || []);
      if (welfareData) setWelfareAlerts(welfareData.results || []);
      if (greetingsData) setGreetingSettings(greetingsData);
      if (serviceDisputesData) setServiceDisputes(serviceDisputesData);
      if (verifiedTechniciansData) setVerifiedTechnicians(verifiedTechniciansData.results || []);
      if (sosRidesData) {
        const openSos = sosRidesData.results || [];
        setSosRides(openSos);
        notifyNewSosRides(openSos);
      }
      setLoadProblem(partial ? { rateLimited: false, retryAfter: null, partial: true } : null);
      setStatus("ready");
    } catch (err) {
      const code = err instanceof ApiStatusError ? err.status : 0;
      if (code === 401) {
        setStatus("signedOut");
      } else if (code === 403) {
        setStatus("notAdmin");
      } else {
        setLoadProblem({
          rateLimited: code === 429,
          retryAfter: err instanceof ApiStatusError ? err.retryAfterSeconds : null,
          partial: false,
        });
        // A refresh that fails while the console is open keeps what's on screen.
        setStatus((prev) => (prev === "ready" ? "ready" : "error"));
      }
    }
  }, [token, notifyNewSosRides]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAll());
  }, [loadAll]);

  useEffect(() => {
    if (!token || status !== "ready") return;
    const interval = setInterval(() => {
      listAdminSosRides(token)
        .then((data) => {
          const openSos = data.results || [];
          setSosRides(openSos);
          notifyNewSosRides(openSos);
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [token, status, notifyNewSosRides]);

  async function enableBrowserSosAlerts() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === "granted") playSosAlertTone();
  }

  // The data admin has no login of its own: open it with a one-time pass from this console session.
  async function openDataAdmin() {
    if (!token) return;
    if (!(await openInDataAdmin(token))) await dialogs.notify(t("dataAdminFailed"));
  }

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
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleRejectProperty(id: string) {
    if (!token) return;
    const res = await rejectPropertyListing(id, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: KYC Review
  async function handleApproveKyc(item: AdminKycReviewItem) {
    if (!token) return;
    const warnings = [
      item.age !== null && item.age < 18 ? t("kycUnderage", { age: item.age }) : "",
      item.duplicate_id_count > 0 ? t("kycIdDuplicate", { count: item.duplicate_id_count }) : "",
      !item.id_document_front_image_url || !item.id_document_back_image_url || !item.selfie_image_url ? t("kycMissingDocs", { count: [item.id_document_front_image_url, item.id_document_back_image_url, item.selfie_image_url].filter((u) => !u).length }) : "",
    ].filter(Boolean);
    const message = t("kycApproveConfirm", { name: item.legal_full_name }) + (warnings.length ? `\n\n${t("kycApproveWarnings")} ${warnings.join("; ")}.` : "");
    if (!(await dialogs.confirm(message, { confirmLabel: t("approve"), destructive: warnings.length > 0 }))) return;
    const res = await approveKyc(item.id, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleRejectKyc(item: AdminKycReviewItem) {
    if (!token) return;
    const reason = await dialogs.ask(t("kycRejectPrompt", { name: item.legal_full_name }), { multiline: true, confirmLabel: t("reject") });
    if (reason === null) return;
    const res = await rejectKyc(item.id, reason, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Withdrawals
  async function readError(res: Response) {
    const body = await res.json().catch(() => null);
    return typeof body?.detail === "string" ? body.detail : t("actionFailed");
  }

  async function handleApproveWithdrawal(w: AdminWithdrawal) {
    if (!token || withdrawalBusyId) return;
    const message = t("withdrawalApproveConfirm", {
      net: Number(w.net_amount_xaf).toLocaleString(),
      phone: w.phone_number || w.user.phone,
      name: w.user.name,
      fee: Number(w.fee_xaf).toLocaleString(),
    });
    if (!(await dialogs.confirm(message, { confirmLabel: t("withdrawalApproveAction") }))) return;
    setWithdrawalBusyId(w.id);
    try {
      const res = await approveWithdrawal(w.id, token);
      if (!res.ok) {
        await dialogs.notify(await readError(res));
        return;
      }
      await Promise.all([loadWithdrawals(), loadAll()]);
    } finally {
      setWithdrawalBusyId(null);
    }
  }

  async function handleRejectWithdrawal(w: AdminWithdrawal) {
    if (!token || withdrawalBusyId) return;
    const reason = await dialogs.ask(t("withdrawalRejectPrompt", { name: w.user.name }), {
      multiline: true,
      required: true,
      confirmLabel: t("reject"),
    });
    if (reason === null) return;
    setWithdrawalBusyId(w.id);
    try {
      const res = await rejectWithdrawal(w.id, reason, token);
      if (!res.ok) {
        await dialogs.notify(await readError(res));
        return;
      }
      await Promise.all([loadWithdrawals(), loadAll()]);
    } finally {
      setWithdrawalBusyId(null);
    }
  }

  // Actions: Reports
  async function handleResolveReport(report: AdminContentReport) {
    if (!token) return;
    const who = report.target.author_name;
    // Confirming a report about content also takes the content down (where it is still up).
    const isPerson = report.target.type === "user";
    const answer = await dialogs.askWithOption(t("actionTakenPlaceholder"), {
      multiline: true,
      required: true,
      confirmLabel: t("resolve"),
      optionLabel: isPerson
        ? who ? t("issueStrikeOption", { name: who }) : t("issueStrikeOptionGeneric")
        : who ? t("removeAndStrikeOption", { name: who }) : t("removeAndStrikeOptionGeneric"),
    });
    if (!answer) return;
    const res = await resolveContentReport(report.id, answer.value, answer.checked, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Disputes
  async function handleRespondDispute(id: string) {
    if (!token) return;
    const res = await respondToDispute(id, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleResolveDispute(id: string, outcome: "RELEASE" | "REFUND") {
    if (!token) return;
    const notes = await dialogs.ask(t("resolutionNotesPlaceholder"), { multiline: true, confirmLabel: t("resolve") });
    if (notes === null) return;
    const res = await resolveDispute(id, outcome, notes, token);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      await dialogs.notify(data.detail || t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Returns the problem to show in the split form, or null once the split is saved.
  async function handleSplitDispute(id: string, payerAmountXaf: number, notes: string): Promise<string | null> {
    if (!token) return t("actionFailed");
    const res = await resolveDispute(id, "SPLIT", notes, token, payerAmountXaf);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.detail || t("actionFailed");
    }
    setSplitDisputeId(null);
    loadAll();
    return null;
  }

  // Actions: Hospitality & Drivers
  async function handleResolveServiceDispute(id: string, outcome: ServiceDisputeOutcome) {
    if (!token) return;
    const notes = await dialogs.ask(t("resolutionNotesPlaceholder"), { multiline: true, confirmLabel: t("resolve") });
    if (notes === null) return;
    const res = await resolveAdminServiceDispute(id, outcome, notes, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Hospitality & Drivers
  async function handleVerifyHotel(id: string) {
    if (!token) return;
    const res = await verifyHotel(id, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleVerifyVenue(id: string) {
    if (!token) return;
    const res = await verifyVenue(id, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleVerifyDriver(id: number) {
    if (!token) return;
    const res = await verifyDriver(id, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleVerifyTechnician(id: number) {
    if (!token) return;
    const res = await verifyTechnician(id, token);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      await dialogs.notify(body?.detail || t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Student Welfare
  async function handleReviewTechnician(id: number, action: "reject" | "revoke") {
    if (!token) return;
    const reason = await dialogs.ask(t(action === "reject" ? "technicianRejectPrompt" : "technicianRevokePrompt"), {
      multiline: true,
      confirmLabel: t(action === "reject" ? "reject" : "dialogConfirm"),
      validate: (value) => (value.length < 3 ? t("dialogReasonTooShort") : null),
    });
    if (reason === null) return;
    const res = await reviewTechnician(id, action, reason, token);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      await dialogs.notify(body?.detail || t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: Student Welfare
  async function handleResolveWelfare(id: string) {
    if (!token) return;
    const res = await resolveAdminWelfareAlert(id, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
      return;
    }
    loadAll();
  }

  // Actions: OaziGo SOS
  async function handleResolveSos(id: string) {
    if (!token) return;
    const res = await resolveAdminSosRide(id, token);
    if (!res.ok) {
      await dialogs.notify(t("actionFailed"));
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
      await dialogs.notify(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setSavingGreetings(false);
    }
  }

  // Actions: User Management
  async function handleToggleSuspendUser(id: string, currentStatus: string) {
    if (!token) return;
    const shouldSuspend = currentStatus === "ACTIVE";
    let days = 0;
    if (shouldSuspend) {
      const answer = await dialogs.ask(t("suspendDaysPrompt"), {
        defaultValue: "30",
        confirmLabel: t("suspendConfirm"),
        validate: (value) => (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 365 ? null : t("suspendDaysInvalid")),
      });
      if (answer === null) return;
      days = Number(answer);
    }
    const res = await toggleAdminUserSuspend(id, shouldSuspend, days, token);
    if (!res.ok) {
      await dialogs.notify(await readError(res));
      return;
    }
    loadUsers(usersPage);
    getAdminConsoleSummary(token).then(setSummary).catch(() => {});
  }

  async function handleIssueUserStrike(id: string) {
    if (!token) return;
    const reason = await dialogs.ask(t("strikeReasonPrompt"), { defaultValue: "REPEATED_VIOLATION", required: true, confirmLabel: t("strikeConfirm") });
    if (!reason) return;
    const res = await issueAdminUserStrike(id, reason, token);
    if (!res.ok) {
      await dialogs.notify(await readError(res));
      return;
    }
    loadUsers(usersPage);
    getAdminConsoleSummary(token).then(setSummary).catch(() => {});
  }

  const ASSIGNABLE_ROLES: { value: AssignableRole; label: string }[] = [
    { value: "landlord", label: t("role_LANDLORD") },
    { value: "agent", label: t("role_AGENT") },
    { value: "agency", label: t("role_AGENCY") },
    { value: "student", label: t("role_STUDENT") },
    { value: "technician", label: t("role_TECHNICIAN") },
    { value: "driver", label: t("role_DRIVER") },
    { value: "admin", label: t("role_ADMIN") },
  ];

  async function handleAssignRole(id: string, role: AssignableRole) {
    if (!token || roleActionBusy) return;
    setRoleActionBusy(true);
    try {
      await assignAdminUserRole(id, role, {}, token);
      loadUsers(usersPage);
    } catch (err) {
      await dialogs.notify(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setRoleActionBusy(false);
    }
  }

  async function handleRemoveRole(id: string, role: AssignableRole) {
    if (!token || roleActionBusy) return;
    if (!(await dialogs.confirm(t("removeRoleConfirm", { role }), { destructive: true, confirmLabel: t("removeRoleLabel") }))) return;
    setRoleActionBusy(true);
    try {
      await removeAdminUserRole(id, role, token);
      loadUsers(usersPage);
    } catch (err) {
      await dialogs.notify(err instanceof Error ? err.message : t("actionFailed"));
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
          <h2 className="text-xl font-bold text-slate-900 mb-2">{t("authRequiredTitle")}</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            {t("authRequiredBody")}
          </p>
          <Button href={tab === "summary" ? "/admin/login" : `/admin/login?tab=${tab}`} className="w-full py-2.5 rounded-xl font-bold">
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
          <h2 className="text-xl font-bold text-slate-900 mb-2">{t("accessDenied")}</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">{t("notAdmin")}</p>
          <Button href={tab === "summary" ? "/admin/login" : `/admin/login?tab=${tab}`} className="w-full py-2.5 rounded-xl font-bold mb-2">
            {t("adminSignInInstead")}
          </Button>
          <Button href="/" variant="secondary" className="w-full py-2.5 rounded-xl">
            {t("returnHome")}
          </Button>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="min-h-[calc(100vh-140px)] flex items-center justify-center py-16 px-4 bg-slate-50">
        <div role="alert" className="max-w-md w-full bg-white rounded-3xl p-8 border border-slate-200/80 shadow-xl text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <IconClock size={28} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">{t("loadFailedTitle")}</h2>
          <p className="text-xs text-slate-500 mb-6 leading-relaxed">
            {loadProblem?.rateLimited
              ? loadProblem.retryAfter
                ? t("loadRateLimitedWait", { seconds: loadProblem.retryAfter })
                : t("loadRateLimited")
              : t("loadFailedBody")}
          </p>
          <Button
            onClick={() => {
              setStatus("loading");
              void loadAll();
            }}
            className="w-full py-2.5 rounded-xl font-bold"
          >
            {t("tryAgain")}
          </Button>
        </div>
      </main>
    );
  }

  if (status === "loading" || !summary) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-20 text-center text-slate-400">
        {t("loadingConsole")}
      </main>
    );
  }

  const pendingListingsTotal = pendingHotels.length + pendingVenues.length + pendingDrivers.length + pendingTechnicians.length;
  const isSuperAdmin = summary.is_super_admin ?? false;
  const supportCount = (summary.support_tickets_awaiting ?? 0) + (summary.open_contact_messages ?? 0);
  const pendingVerifications = summary.pending_verification_requests ?? 0;
  const analytics = summary.platform_analytics;

  const tabIcons: Record<Tab, React.ComponentType<{ size?: number; className?: string }>> = {
    summary: IconSparkles,
    properties: IconHome,
    listings: IconBuilding,
    verifications: IconShieldCheck,
    kyc: IconShield,
    reports: IconAlertCircle,
    content: IconEye,
    aiflags: IconAlertCircle,
    areas: IconMapPin,
    disputes: IconLock,
    withdrawals: IconCreditCard,
    payments: IconCreditCard,
    pricing: IconBuilding,
    support: IconMessageCircle,
    welfare: IconGraduationCap,
    sos: IconAlertCircle,
    users: IconUsers,
    greetings: IconSparkles,
    faqs: IconMapPin,
    audit: IconClock,
    visitors: IconEye,
    privacy: IconLock,
    analytics: IconSparkles,
    rooms: IconGraduationCap,
    certificates: IconGraduationCap,
    trainers: IconUsers,
  };

  const tabs: { key: Tab; label: string; count?: number; isUrgent?: boolean }[] = [

    { key: "summary", label: t("tabSummary") },
    { key: "analytics", label: t("tabAnalytics") },
    { key: "properties", label: t("tabPropertyListings"), count: pendingProperties.length },
    { key: "listings", label: t("tabListings"), count: pendingListingsTotal },

    { key: "verifications", label: t("tabVerifications"), count: pendingVerifications },
    { key: "kyc", label: t("tabKyc"), count: kycReviews.length },
    { key: "areas", label: t("tabAreas"), count: summary.pending_area_suggestions ?? 0 },
    { key: "reports", label: t("tabReports"), count: reports.length, isUrgent: reports.length > 0 },
    { key: "content", label: t("tabContent") },
    { key: "aiflags", label: t("tabAiFlags"), count: summary.ai_flags_pending ?? 0, isUrgent: (summary.ai_flags_pending ?? 0) > 0 },
    { key: "disputes", label: t("tabDisputes"), count: disputes.length + serviceDisputes.length, isUrgent: disputes.length + serviceDisputes.length > 0 },
    { key: "withdrawals", label: t("tabWithdrawals"), count: summary.pending_withdrawals ?? 0, isUrgent: (summary.pending_withdrawals ?? 0) > 0 },
    { key: "payments", label: t("tabPayments"), count: summary.stuck_payments ?? 0, isUrgent: (summary.stuck_payments ?? 0) > 0 },
    ...(isSuperAdmin ? [{ key: "pricing" as Tab, label: t("tabPricing") }] : []),
    { key: "welfare", label: t("tabWelfareAlerts"), count: welfareAlerts.filter((w) => !w.resolved_at).length, isUrgent: welfareAlerts.filter((w) => !w.resolved_at).length > 0 },

    { key: "rooms", label: t("tabRooms") },
    { key: "sos", label: t("tabSos"), count: sosRides.length, isUrgent: sosRides.length > 0 },
    { key: "users", label: t("tabUsers"), count: summary.flagged_users_count ?? 0, isUrgent: (summary.flagged_users_count ?? 0) > 0 },
    { key: "support", label: t("tabSupport"), count: supportCount, isUrgent: (summary.support_tickets_awaiting ?? 0) > 0 },
    { key: "greetings", label: t("tabGreetings") || "Celebratory Messages" },
    { key: "faqs", label: t("tabFaqs") },
    { key: "certificates", label: t("tabCertificates") }, { key: "trainers", label: t("tabTrainers"), count: summary.courses_awaiting_review ?? 0 },

    { key: "visitors", label: t("tabVisitors") },
    { key: "privacy", label: t("tabPrivacy"), count: summary.scheduled_account_deletions ?? 0 },
    ...(isSuperAdmin ? [{ key: "audit" as Tab, label: t("tabAudit") }] : []),
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
        { key: "analytics", label: t("tabAnalytics") },
        { key: "greetings", label: t("tabGreetings") || "Celebratory Messages" },
        { key: "faqs", label: t("tabFaqs") },
        { key: "certificates", label: t("tabCertificates") }, { key: "trainers", label: t("tabTrainers"), count: summary.courses_awaiting_review ?? 0 },

        { key: "visitors", label: t("tabVisitors") },
        { key: "privacy", label: t("tabPrivacy"), count: summary.scheduled_account_deletions ?? 0 },
        ...(isSuperAdmin ? [{ key: "audit" as Tab, label: t("tabAudit") }] : []),
      ],
    },
    {
      title: t("groupApprovals"),
      items: [
        { key: "properties", label: t("tabPropertyListings"), count: pendingProperties.length },
        { key: "listings", label: t("tabListings"), count: pendingListingsTotal },

        { key: "verifications", label: t("tabVerifications"), count: pendingVerifications },
        { key: "kyc", label: t("tabKyc"), count: kycReviews.length },
        { key: "areas", label: t("tabAreas"), count: summary.pending_area_suggestions ?? 0 },
      ],
    },
    {
      title: t("groupFinance"),
      items: [
        { key: "withdrawals", label: t("tabWithdrawals"), count: summary.pending_withdrawals ?? 0, isUrgent: (summary.pending_withdrawals ?? 0) > 0 },
        { key: "payments", label: t("tabPayments"), count: summary.stuck_payments ?? 0, isUrgent: (summary.stuck_payments ?? 0) > 0 },
        ...(isSuperAdmin ? [{ key: "pricing" as Tab, label: t("tabPricing") }] : []),
      ],
    },
    {
      title: t("groupTrust"),
      items: [
        { key: "reports", label: t("tabReports"), count: reports.length, isUrgent: reports.length > 0 },
        { key: "content", label: t("tabContent") },
        { key: "aiflags", label: t("tabAiFlags"), count: summary.ai_flags_pending ?? 0, isUrgent: (summary.ai_flags_pending ?? 0) > 0 },
        { key: "disputes", label: t("tabDisputes"), count: disputes.length + serviceDisputes.length, isUrgent: disputes.length + serviceDisputes.length > 0 },
        { key: "welfare", label: t("tabWelfareAlerts"), count: welfareAlerts.filter((w) => !w.resolved_at).length, isUrgent: welfareAlerts.filter((w) => !w.resolved_at).length > 0 },

        { key: "rooms", label: t("tabRooms") },
        { key: "sos", label: t("tabSos"), count: sosRides.length, isUrgent: sosRides.length > 0 },
        { key: "users", label: t("tabUsers"), count: summary.flagged_users_count ?? 0, isUrgent: (summary.flagged_users_count ?? 0) > 0 },
        { key: "support", label: t("tabSupport"), count: supportCount, isUrgent: (summary.support_tickets_awaiting ?? 0) > 0 },
      ],
    },
  ];

  const totalPendingActionCount =
    pendingProperties.length +
    pendingListingsTotal +
    pendingVerifications +
    kycReviews.length +
    reports.length +
    disputes.length +
    serviceDisputes.length +
    welfareAlerts.filter((w) => !w.resolved_at).length +
    sosRides.length +
    (summary.pending_withdrawals ?? 0) +
    (summary.stuck_payments ?? 0) +
    supportCount +
    (summary.ai_flags_pending ?? 0) +
    (summary.pending_area_suggestions ?? 0) +
    (summary.flagged_users_count ?? 0);

  const bottomTabKeys: Tab[] = ["summary", "kyc", "reports", "disputes"];
  const bottomTabItems: MobileTabItem[] = [
    ...bottomTabKeys.map((key): MobileTabItem => {
      const Icon = tabIcons[key];
      const item = tabs.find((x) => x.key === key);
      return {
        id: key,
        label: key === "reports" ? t("tabReportsShort") : (item?.label ?? key),
        icon: <Icon size={22} />,
        onClick: () => {
          setTab(key);
          setNavOpen(false);
          window.scrollTo({ top: 0 });
        },
        active: tab === key && !navOpen,
        badge: item?.count,
      };
    }),
    {
      id: "more",
      label: t("tabMore"),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      ),
      onClick: () => setNavOpen((open) => !open),
      expanded: navOpen,
      active: navOpen || !bottomTabKeys.includes(tab),
      badge: totalPendingActionCount,
    },
  ];

  return (
    <DataAdminAccess.Provider value={isSuperAdmin ? token : null}>
    <main className="min-h-screen lg:pl-72 xl:pl-80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-10">
      {dialogs.element}
      {/* Mobile/tablet: sticky top bar that opens the navigation drawer */}
      <div className="lg:hidden sticky top-0 z-30 -mx-4 sm:-mx-6 -mt-8 md:-mt-10 mb-6 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 bg-white/95 backdrop-blur border-b border-slate-200">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-expanded={navOpen}
          aria-label={t("openMenu")}
          className="flex items-center gap-2.5 min-w-0 px-2.5 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold shadow-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span className="truncate">{tabs.find((x) => x.key === tab)?.label ?? t("title")}</span>
          {totalPendingActionCount > 0 && (
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-950">{totalPendingActionCount}</span>
          )}
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <LanguageSwitcher variant="light" />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label={t("refresh")}
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors disabled:opacity-50"
          >
            <IconRefresh size={15} className={isRefreshing ? "animate-spin text-amber-600" : "text-slate-600"} />
          </button>
        </div>
      </div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex items-center gap-2">
            {notifPermission === "default" && (
              <button
                type="button"
                onClick={enableBrowserSosAlerts}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors cursor-pointer"
              >
                🔔 {t("sosEnableAlerts")}
              </button>
            )}
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {t("liveState")}
            </span>
          </div>
        }
      />
      {loadProblem && (
        <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <span>
            {loadProblem.rateLimited
              ? loadProblem.retryAfter
                ? t("staleRateLimitedWait", { seconds: loadProblem.retryAfter })
                : t("staleRateLimited")
              : loadProblem.partial
                ? t("stalePartial")
                : t("staleFailed")}
          </span>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="px-3 py-1.5 rounded-xl font-bold bg-white border border-amber-300 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            {t("tryAgain")}
          </button>
        </div>
      )}

      {sosRides.length > 0 && (
        <div className="mb-6 rounded-2xl border-2 border-red-500 bg-red-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-xl">🆘</span>
            <div>
              <p className="text-sm font-black text-red-900">{t("sosUrgentBanner", { count: sosRides.length })}</p>
              <p className="text-xs text-red-700">
                {sosRides[0].raised_by?.name ?? "—"} ({sosRides[0].raised_by?.phone}) · {sosRides[0].pickup_description} → {sosRides[0].dropoff_description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={playSosAlertTone}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-red-700 border border-red-200 hover:bg-red-100 cursor-pointer"
            >
              🔊 {t("sosTestSound")}
            </button>
            {tab !== "sos" && (
              <button
                type="button"
                onClick={() => setTab("sos")}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 cursor-pointer"
              >
                {t("tabSos")} ({sosRides.length})
              </button>
            )}
          </div>
        </div>
      )}

      <div>
        <MobileTabBar items={bottomTabItems} label={t("title")} />
        {/* Mobile/tablet: backdrop for the slide-in drawer */}
        {navOpen && (
          <button
            type="button"
            aria-label={t("closeMenu")}
            onClick={() => setNavOpen(false)}
            className="lg:hidden fixed inset-0 z-[65] bg-slate-950/60 backdrop-blur-[2px] cursor-default"
          />
        )}
        {/* Sidebar: pinned panel on desktop, slide-in drawer below lg */}
        <aside
          className={`fixed inset-y-0 left-0 z-[70] lg:z-30 w-[18rem] max-w-[85vw] lg:max-w-none lg:w-72 xl:w-80 bg-slate-950 border-r border-slate-800/90 transition-transform duration-200 lg:translate-x-0 ${
            navOpen ? "translate-x-0 shadow-2xl shadow-black/50" : "-translate-x-full"
          }`}
        >
          <div className="h-full p-4 flex flex-col gap-4 text-slate-300">
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              className="lg:hidden shrink-0 self-end -mb-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-900"
            >
              <IconX size={14} />
              <span>{t("closeMenu")}</span>
            </button>
            
            {/* Top Admin Identity & Status Card */}
            <div className="p-3.5 rounded-2xl shrink-0 bg-gradient-to-br from-slate-900 to-slate-900/90 border border-slate-800/80 text-white shadow-inner relative overflow-hidden">
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
                      {t("liveBadge")}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {t("identitySubtitle")}
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
                    <span className="text-[9px] uppercase font-bold tracking-wider">{t("tasksUnit")}</span>
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
            <nav className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto overscroll-contain -mr-2 pr-2 [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
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
                          onClick={() => {
                            setTab(tabItem.key);
                            setNavOpen(false);
                          }}
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
            <div className="pt-2 border-t border-slate-850 flex flex-col gap-2 shrink-0">
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
              <div className="flex items-center justify-center pt-1">
                <LanguageSwitcher />
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                {isSuperAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={openDataAdmin}
                      title={t("dataAdminHint")}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-bold text-slate-400 hover:text-amber-300 hover:bg-slate-900 transition-colors"
                    >
                      <span>{t("djangoAdmin")}</span>
                      <IconArrowUpRight size={12} className="text-slate-500" />
                    </button>
                    <span className="text-slate-800">|</span>
                  </>
                )}
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
                {t("footnote")}
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
              <span>{t("groupFinancial")}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 mb-1">{t("totalEscrowVolume")}</p>
                <p className="text-2xl font-extrabold text-slate-900">
                  {analytics ? Number(analytics.escrow_volume_xaf).toLocaleString() : "0"} <span className="text-xs font-medium text-slate-400">XAF</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-1">{t("hintAllBookings")}</p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 mb-1">{t("escrowHeld")}</p>
                <p className="text-2xl font-extrabold text-amber-600">
                  {analytics ? Number(analytics.escrow_held_xaf).toLocaleString() : "0"} <span className="text-xs font-medium text-slate-400">XAF</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-1">{t("hintEscrowHeld")}</p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 mb-1">{t("escrowReleased")}</p>
                <p className="text-2xl font-extrabold text-emerald-600">
                  {analytics ? Number(analytics.escrow_released_xaf).toLocaleString() : "0"} <span className="text-xs font-medium text-slate-400">XAF</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-1">{t("hintEscrowReleased")}</p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 mb-1">{t("platformRevenue")}</p>
                <p className="text-2xl font-extrabold text-indigo-600">
                  {analytics ? Number(analytics.platform_revenue_xaf).toLocaleString() : "0"} <span className="text-xs font-medium text-slate-400">XAF</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-1">{t("hintPlatformRevenue")}</p>
              </div>
            </div>
          </div>

          {/* Operational Metrics & Growth Cards */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
              <IconBuilding size={14} />
              <span>{t("groupInventory")}</span>
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
              <span>{t("groupPendingQueues")}</span>
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
                  <p className="text-xs text-slate-400                   mt-1">{t("hintPendingProperties")}</p>
                </div>
                <button onClick={() => setTab("properties")} className="mt-4 text-xs font-bold text-amber-600 hover:text-amber-700 text-left">
                                    {t("reviewListingsLink")}
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
                  <p className="text-xs text-slate-400                   mt-1">{t("hintOpenDisputes")}</p>
                </div>
                <button onClick={() => setTab("disputes")} className="mt-4 text-xs font-bold text-amber-600 hover:text-amber-700 text-left">
                                    {t("manageEscrowLink")}
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
                  <p className="text-xs text-slate-400                   mt-1">{t("hintWelfare")}</p>
                </div>
                <button onClick={() => setTab("welfare")} className="mt-4 text-xs font-bold text-amber-600 hover:text-amber-700 text-left">
                                    {t("reviewWelfareLink")}
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
              <p className="text-xs text-slate-400 mt-1">{t("propertiesEmpty")}</p>
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
                        {t("noPhoto")}
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
                        {p.property_asset.description || t("noDescription")}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">{t("listedBy", { name: p.lister_display_name })}</p>
                      <DataAdminLink path={dataAdminPath.propertyListing(p.id)} className="mt-1" />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <button
                      onClick={() => handleApproveProperty(p.id)}
                      className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shadow-sm"
                    >
                      {t("approvePublish")}
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
              <p className="text-xs text-slate-400 mt-1">{t("listingsEmpty")}</p>
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
                      {t("hotelReview")}
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">{h.quarter_name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {h.star_rating ? `${t("starsLabel", { count: h.star_rating })} • ` : ""}
                      {t("roomTypesCount", { count: h.room_types.length })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleVerifyHotel(h.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    {t("verifyHotel")}
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
                      {t("eventVenueReview")}
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">
                      {v.spaces[0]?.space_name || t("eventVenue")} — {v.quarter_name}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">{t("spacesCount", { count: v.spaces.length })}</p>
                  </div>
                  <button
                    onClick={() => handleVerifyVenue(v.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    {t("verifyVenue")}
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
                      {t("driverReview")}
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">{d.user_name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t("licenseLabel")}: {d.license_number} &bull; {t("vehiclesCount", { count: d.vehicles.length })}
                    </p>
                  </div>
                  <button
                    onClick={() => handleVerifyDriver(d.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    {t("verifyDriver")}
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
      {tab === "verifications" && token && (
        <AdminVerificationQueue
          token={token}
          dialogs={dialogs}
          onChanged={() => {
            getAdminConsoleSummary(token).then(setSummary).catch(() => {});
          }}
        />
      )}

      {/* ================= TAB: KYC REVIEW ================= */}
      {tab === "kyc" && (
        <div className="space-y-4 animate-rise-in">
          {kycReviews.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">{t("kycEmpty")}</p>
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold text-slate-500">{t("kycQueueSummary", { count: kycReviews.length })}</p>
              {kycReviews.map((k) => (
                <div key={k.id} className="space-y-1">
                  <AdminKycReviewCard item={k} onApprove={handleApproveKyc} onReject={handleRejectKyc} />
                  <DataAdminLink path={dataAdminPath.kyc(k.id)} className="px-2" />
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ================= TAB: CONTENT REPORTS & STRIKES ================= */}
      {tab === "reports" && (
        <div className="space-y-4 animate-rise-in">
          {reports.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">{t("reportsEmpty")}</p>
            </div>
          ) : (
            reports.map((r) => (
              <div
                key={r.id}
                className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex items-start justify-between flex-wrap gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Badge variant="clay">{r.reason}</Badge>
                    <Badge variant="neutral">{t.has(`targetType_${r.target.type}`) ? t(`targetType_${r.target.type}`) : t("targetType_unknown")}</Badge>
                    {!r.target.available && <Badge variant="gold">{r.target.type === "listing_deleted" || r.target.type === "deleted" ? t("targetDeleted") : t("targetHidden")}</Badge>}
                    <span className="text-xs text-slate-400 font-medium">
                      {t("reportedBy", { name: r.reported_by_name })} · {new Date(r.created_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 mb-2">
                    {r.target.title && <p className="text-sm font-bold text-slate-900">{r.target.title}</p>}
                    {r.target.excerpt && <p className="text-xs text-slate-700 leading-relaxed mt-0.5 break-words">{r.target.excerpt}</p>}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                      {r.target.author_name && r.target.type !== "user" && <span>{t("postedBy", { name: r.target.author_name })}</span>}
                      {r.target.author_id && r.target.type !== "user" && (
                        <Link href={`/user/${r.target.author_id}`} target="_blank" className="font-semibold text-amber-700 hover:text-amber-800 underline">{t("viewAuthor")}</Link>
                      )}
                      {r.target.path && (
                        <Link href={r.target.path} target="_blank" className="font-semibold text-amber-700 hover:text-amber-800 underline">{t("openReported")} ↗</Link>
                      )}
                    </div>
                  </div>

                  {r.notes && <p className="text-xs text-slate-700 leading-relaxed"><span className="font-semibold text-slate-500">{t("reporterNotes")}:</span> {r.notes}</p>}
                  <DataAdminLink path={dataAdminPath.report(r.id)} className="mt-2" />
                </div>
                <div>
                  <button
                    onClick={() => handleResolveReport(r)}
                    className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors"
                  >
                    {t("resolveReport")}
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
              <p className="text-xs text-slate-400 mt-1">{t("disputesEmpty")}</p>
            </div>
          ) : (
            disputes.map((d) => (
              <div
                key={d.id}
                className="border border-slate-200/80 rounded-2xl p-6 bg-white shadow-sm flex flex-col gap-4"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{t("disputeNumber", { id: d.id.slice(0, 8) })}</span>
                    <Badge variant="gold">{d.status}</Badge>
                  </div>
                  <DataAdminLink path={dataAdminPath.dispute(d.id)} />
                </div>

                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  {d.reason}
                </p>

                {d.payment && (
                  <div className="rounded-xl border border-slate-100 bg-white p-3.5 text-xs text-slate-600 space-y-1">
                    <p className="font-bold text-slate-900">
                      {d.payment.title}
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        {t.has(`paymentType_${d.payment.booking_type}`) ? t(`paymentType_${d.payment.booking_type}`) : d.payment.booking_type}
                      </span>
                      {d.payment.note && (
                        <span className="ml-1.5 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                          {t.has(`paymentNote_${d.payment.note}`) ? t(`paymentNote_${d.payment.note}`) : d.payment.note}
                        </span>
                      )}
                    </p>
                    <p>
                      {t("disputePayer")}: <span className="font-semibold text-slate-800">{d.payment.payer ? `${d.payment.payer.name} (@${d.payment.payer.username})` : "—"}</span>
                      {" · "}
                      {t("disputePayee")}: <span className="font-semibold text-slate-800">{d.payment.payee ? `${d.payment.payee.name} (@${d.payment.payee.username})` : "—"}</span>
                    </p>
                    <p>
                      {t("disputeAmountHeld")}: <span className="font-bold text-slate-900">{Number(d.payment.gross_xaf).toLocaleString()} XAF</span>
                      {" · "}
                      {t("paymentFee", { fee: Number(d.payment.fee_xaf).toLocaleString() })}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setActiveDisputeChatId(activeDisputeChatId === d.id ? null : d.id)}
                    className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    <span>💬 {activeDisputeChatId === d.id ? t("hideMediation") : t("openMediation")}</span>
                  </button>
                  {d.status === "OPEN" && (
                    <button
                      onClick={() => handleRespondDispute(d.id)}
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                    >
                      {t("acknowledge")}
                    </button>
                  )}
                  <button
                    onClick={() => handleResolveDispute(d.id, "RELEASE")}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    {d.payment && !["GENERAL_RENTAL", "LAND_RESERVATION"].includes(d.payment.booking_type) ? t("disputePaySeller") : t("releaseToLandlord")}
                  </button>
                  <button
                    onClick={() => handleResolveDispute(d.id, "REFUND")}
                    className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    {d.payment && !["GENERAL_RENTAL", "LAND_RESERVATION"].includes(d.payment.booking_type) ? t("disputeRefundPayer") : t("refundTenant")}
                  </button>
                  {d.payment && Number(d.payment.gross_xaf) > 1 && (
                    <button
                      onClick={() => setSplitDisputeId(splitDisputeId === d.id ? null : d.id)}
                      aria-expanded={splitDisputeId === d.id}
                      className="bg-violet-700 hover:bg-violet-600 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                    >
                      {t("splitButton")}
                    </button>
                  )}
                </div>

                {splitDisputeId === d.id && d.payment && (
                  <DisputeSplitForm
                    grossXaf={d.payment.gross_xaf}
                    feeXaf={d.payment.fee_xaf}
                    payerName={d.payment.payer?.name || t("disputePayer")}
                    payeeName={d.payment.payee?.name || t("disputePayee")}
                    onSubmit={(amount, notes) => handleSplitDispute(d.id, amount, notes)}
                    onCancel={() => setSplitDisputeId(null)}
                  />
                )}

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

      {/* ================= TAB: WITHDRAWALS (cash-out review) ================= */}
      {tab === "withdrawals" && (
        <div className="space-y-4 animate-rise-in">
          <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">{t("withdrawalsIntro")}</p>
          <div className="flex gap-2 flex-wrap pb-2 border-b border-slate-200/80">
            {(["PENDING", "PAID_OUT", "REJECTED"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setWithdrawalFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  withdrawalFilter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {t(`withdrawalFilter_${f}`)}
                {f === "PENDING" && (summary.pending_withdrawals ?? 0) > 0 ? ` (${summary.pending_withdrawals})` : ""}
              </button>
            ))}
          </div>

          {withdrawalsLoading ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("usersLoading")}</p>
            </div>
          ) : withdrawals.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">{t("withdrawalsEmpty")}</p>
            </div>
          ) : (
            withdrawals.map((w) => {
              const destination = w.phone_number || w.user.phone;
              const providerLabel = w.provider === "ORANGE_MONEY" ? "Orange Money" : "MTN MoMo";
              const kycOk = w.kyc_status === "VERIFIED";
              return (
                <div key={w.id} className="border border-slate-200/80 rounded-2xl p-5 bg-white shadow-sm flex flex-col gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-bold text-slate-900 text-sm">{w.user.name}</span>
                        <span className="text-xs text-slate-500">@{w.user.username}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            kycOk ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {t(`withdrawalKyc_${w.kyc_status}`)}
                        </span>
                        {w.user.account_status !== "ACTIVE" && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                            {t(`userStatus_${w.user.account_status}`)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {t("withdrawalRequestedAt", { when: new Date(w.requested_at).toLocaleString() })}
                      </p>
                      <DataAdminLink path={dataAdminPath.withdrawal(w.id)} className="mt-1" />
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-extrabold text-slate-900">
                        {Number(w.amount_xaf).toLocaleString()} <span className="text-xs font-medium text-slate-400">XAF</span>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t("withdrawalFeeNet", { fee: Number(w.fee_xaf).toLocaleString(), net: Number(w.net_amount_xaf).toLocaleString() })}
                      </p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                      <dt className="font-semibold text-slate-500">{t("withdrawalSendTo")}</dt>
                      <dd className="mt-0.5 font-bold text-slate-900">{destination}</dd>
                      <dd className="text-slate-500">{providerLabel}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                      <dt className="font-semibold text-slate-500">{t("withdrawalBalanceLeft")}</dt>
                      <dd className="mt-0.5 font-bold text-slate-900">{Number(w.wallet_balance_xaf).toLocaleString()} XAF</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                      <dt className="font-semibold text-slate-500">{t("withdrawalPaidBefore")}</dt>
                      <dd className="mt-0.5 font-bold text-slate-900">{Number(w.paid_out_total_xaf).toLocaleString()} XAF</dd>
                    </div>
                  </dl>

                  {w.status === "PENDING" ? (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                      <button
                        onClick={() => handleApproveWithdrawal(w)}
                        disabled={withdrawalBusyId !== null}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {withdrawalBusyId === w.id ? t("refreshing") : t("withdrawalApproveAction")}
                      </button>
                      <button
                        onClick={() => handleRejectWithdrawal(w)}
                        disabled={withdrawalBusyId !== null}
                        className="bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {t("reject")}
                      </button>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-0.5">
                      {w.reviewed_by_name && <p>{t("withdrawalReviewedBy", { name: w.reviewed_by_name })}</p>}
                      {w.rejection_reason && <p>{t("withdrawalReason", { reason: w.rejection_reason })}</p>}
                      {w.payout_reference && <p>{t("withdrawalPayoutRef", { ref: w.payout_reference })}</p>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ================= TAB: STUDENT WELFARE ALERTS QUEUE (§8.4) ================= */}
      {tab === "welfare" && (
        <div className="space-y-4 animate-rise-in">
          {welfareAlerts.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">{t("welfareEmpty")}</p>
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
                    <span className="font-bold text-slate-900 text-sm">{t("studentLabel", { name: w.student_name || w.student_username })}</span>
                    <span className="text-xs text-slate-500">({w.student_phone})</span>
                    {w.resolved_at ? (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                        {t("resolvedLabel")}
                      </span>
                    ) : (
                      <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                        {t("activeAlert")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed mb-1">{w.details || t("noDetails")}</p>
                  <p className="text-[11px] text-slate-400">
                    {w.raised_by_name
                      ? t("raisedAtBy", { when: new Date(w.created_at).toLocaleString(), name: w.raised_by_name })
                      : t("raisedAt", { when: new Date(w.created_at).toLocaleString() })}
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setUserSearch(userSearchInput.trim());
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="search"
              value={userSearchInput}
              onChange={(e) => setUserSearchInput(e.target.value)}
              placeholder={t("usersSearchPlaceholder")}
              aria-label={t("usersSearch")}
              className="min-w-[14rem] max-w-md grow rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
              {t("usersSearch")}
            </button>
            {(userSearch || userSearchInput) && (
              <button
                type="button"
                onClick={() => {
                  setUserSearchInput("");
                  setUserSearch("");
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                {t("usersSearchClear")}
              </button>
            )}
          </form>
          {userSearch && <p className="text-xs font-semibold text-slate-500">{t("usersSearchResults", { query: userSearch })}</p>}

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
                  {t(`userStatus_${f}`)}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {usersLoading ? t("usersLoading") : t("usersTotal", { count: usersCount })}
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
                {r === "ALL" ? t("allRoles") : t(`role_${r}`)}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {usersLoading ? (
              <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
                <p className="text-sm font-semibold text-slate-600">{t("usersLoading")}</p>
              </div>
            ) : users.length === 0 ? (
              <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
                <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              </div>
            ) : (
              users.map((u) => {
              const roleBadges: { label: string; value: AssignableRole; on: boolean }[] = [
                { label: t("role_LANDLORD"), value: "landlord", on: u.is_landlord },
                { label: t("role_AGENT"), value: "agent", on: u.is_agent },
                { label: t("role_AGENCY"), value: "agency", on: u.is_agency },
                { label: t("role_STUDENT"), value: "student", on: u.is_student },
                { label: t("role_TECHNICIAN"), value: "technician", on: u.is_technician },
                { label: t("role_DRIVER"), value: "driver", on: u.is_driver },
                { label: t("role_ADMIN"), value: "admin", on: u.is_admin },
              ];
              const activeRoleBadges = roleBadges.filter((r) => r.on);
              const availableRoles = ASSIGNABLE_ROLES.filter(
                (r) => !roleBadges.find((b) => b.value === r.value)?.on && (r.value !== "admin" || isSuperAdmin)
              );
              const canDiscipline = !u.is_admin && !u.is_self;
              return (
              <div
                key={u.id}
                className="border border-slate-200/80 rounded-2xl p-4 bg-white shadow-sm flex flex-col md:flex-row md:flex-wrap items-start md:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-slate-900 text-sm">{u.username}</span>
                    {u.is_self && (
                      <span className="text-[10px] bg-slate-900 text-white font-bold px-2 py-0.5 rounded-full">{t("youBadge")}</span>
                    )}
                    <span className="text-xs text-slate-500">({u.phone})</span>
                    <DataAdminLink path={dataAdminPath.user(u.id)} />
                    {activeRoleBadges.length === 0 ? (
                      <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-full">
                        {t("regularUser")}
                      </span>
                    ) : (
                      activeRoleBadges.map((r) => (
                        <span
                          key={r.label}
                          className="text-[10px] bg-blue-50 text-blue-800 border border-blue-200 font-bold pl-2 pr-1 py-0.5 rounded-full flex items-center gap-1"
                        >
                          {r.label}
                          {!(r.value === "admin" && (u.is_self || !isSuperAdmin)) && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRole(u.id, r.value)}
                              title={t("removeRoleTitle", { role: r.label })}
                              className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-blue-200 text-blue-700 leading-none"
                            >
                              &times;
                            </button>
                          )}
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
                      {t(`userStatus_${u.account_status}`)}
                    </span>
                    {u.strikes_count > 0 && (
                      <span className="text-[10px] bg-rose-50 border border-rose-200 text-rose-700 font-extrabold px-2 py-0.5 rounded-full">
                        {t("strikeCount", { count: u.strikes_count })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {t("joinedOn", { date: new Date(u.date_joined).toLocaleDateString() })}
                    {u.suspended_until ? ` • ${t("suspendedUntil", { date: new Date(u.suspended_until).toLocaleDateString() })}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setOverviewUserId(overviewUserId === u.id ? null : u.id)}
                    aria-expanded={overviewUserId === u.id}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                  >
                    {overviewUserId === u.id ? t("overviewHide") : t("overviewShow")}
                  </button>
                  {(canDiscipline || u.account_status !== "ACTIVE") && (
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
                  )}

                  {canDiscipline ? (
                    <button
                      onClick={() => handleIssueUserStrike(u.id)}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 transition-colors"
                    >
                      {t("issueWarning")}
                    </button>
                  ) : (
                    <span className="text-[11px] font-semibold text-slate-400 max-w-[14rem]">
                      {u.is_self ? t("cannotDisciplineSelf") : t("cannotDisciplineAdmin")}
                    </span>
                  )}

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
                      {t("addRole")}
                    </button>
                    {roleManagerUserId === u.id && (
                      <div className="absolute right-0 z-10 mt-1.5 w-44 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5">
                        {availableRoles.length === 0 ? (
                          <p className="text-[11px] text-slate-400 px-2 py-1.5">{t("allRolesAssigned")}</p>
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
                {overviewUserId === u.id && token && (
                  <AdminUserOverviewPanel userId={u.id} token={token} onClose={() => setOverviewUserId(null)} />
                )}
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
                {t("previous")}
              </button>
              <span className="text-xs text-slate-500 font-medium">{t("pageN", { n: usersPage })}</span>
              <button
                onClick={() => loadUsers(usersPage + 1)}
                disabled={!usersHasNext || usersLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("next")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB: PRICING ================= */}
      {tab === "payments" && token && <AdminPayments token={token} onOpenDisputes={() => setTab("disputes")} />}
      {tab === "pricing" && isSuperAdmin && token && <AdminPricingEditor token={token} dialogs={dialogs} />}

      {/* ================= TAB: PUBLISHED CONTENT ================= */}
      {tab === "content" && token && <AdminContentBrowser token={token} dialogs={dialogs} />}

      {/* ================= TAB: AI-FLAGGED CONTENT ================= */}
      {tab === "areas" && token && (
        <AdminAreaRequests
          token={token}
          dialogs={dialogs}
          onChanged={() => {
            getAdminConsoleSummary(token).then(setSummary).catch(() => {});
          }}
        />
      )}

      {tab === "aiflags" && token && (
        <AdminAiFlagsQueue
          token={token}
          dialogs={dialogs}
          onChanged={() => {
            getAdminConsoleSummary(token).then(setSummary).catch(() => {});
          }}
        />
      )}

      {/* ================= TAB: SUPPORT INBOX ================= */}
      {tab === "support" && token && (
        <AdminSupportInbox
          token={token}
          dialogs={dialogs}
          awaitingCount={summary.support_tickets_awaiting ?? 0}
          openContactCount={summary.open_contact_messages ?? 0}
          onChanged={() => {
            getAdminConsoleSummary(token).then(setSummary).catch(() => {});
          }}
        />
      )}

      {tab === "analytics" && token && <AdminAnalyticsPanel token={token} />}

      {tab === "certificates" && token && <AdminCertificateDesigner token={token} dialogs={dialogs} />}

      {tab === "trainers" && token && <AdminCourseCreators token={token} dialogs={dialogs} />}

      {tab === "rooms" && token && <HostelRoomsManager token={token} adminMode />}

      {tab === "privacy" && token && (
        <AdminPrivacyRequests
          token={token}
          dialogs={dialogs}
          isSuperAdmin={isSuperAdmin}
          onChanged={() => {
            getAdminConsoleSummary(token).then(setSummary).catch(() => {});
          }}
        />
      )}

      {/* ================= TAB: VISITORS ================= */}
      {tab === "visitors" && (() => {
        const regionNames = (() => {
          try {
            return new Intl.DisplayNames([locale], { type: "region" });
          } catch {
            return null;
          }
        })();
        const countryName = (code: string) => (code ? regionNames?.of(code.toUpperCase()) ?? code : t("visitorsUnknownLocation"));
        const place = (code: string, city: string, region: string) => {
          const parts = [city, !city ? region : "", code ? countryName(code) : ""].filter(Boolean);
          return (
            <>
              <CountryBadge code={code} />
              {parts.length ? parts.join(", ") : t("visitorsUnknownLocation")}
            </>
          );
        };
        const data = visitorData;
        const kpis = data
          ? [
              { label: t("visitorsOnline"), value: data.online_now.toLocaleString(), accent: true },
              { label: t("visitorsToday"), value: data.today.visitors.toLocaleString() },
              { label: t("visitorsUnique"), value: data.totals.visitors.toLocaleString() },
              { label: t("visitorsPageViews"), value: data.totals.page_views.toLocaleString() },
              { label: t("visitorsPagesPer"), value: String(data.totals.pages_per_visitor) },
              { label: t("visitorsMobile"), value: `${data.totals.mobile_share}%` },
              { label: t("visitorsCountries"), value: String(data.totals.countries) },
            ]
          : [];
        const maxDaily = data ? Math.max(1, ...data.daily.map((d) => d.page_views)) : 1;
        const rows = (list: { key: string; page_views: number; visitors: number }[], label: (key: string) => string) =>
          list.map((r) => ({ key: r.key, label: label(r.key), value: r.visitors }));
        return (
          <div className="space-y-5 animate-rise-in">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("visitorsIntro")}</p>
              <div className="flex gap-1.5">
                {[1, 7, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setVisitorDays(d)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                      visitorDays === d ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {t(`visitorsRange_${d}`)}
                  </button>
                ))}
              </div>
            </div>

            {visitorError && !data ? (
              <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
                <p className="text-sm font-semibold text-rose-700">{t("visitorsLoadError")}</p>
              </div>
            ) : !data ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
                <p className="text-sm font-semibold text-slate-600">{t("usersLoading")}</p>
              </div>
            ) : (
              <>
                <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7 ${visitorLoading ? "opacity-70" : ""}`}>
                  {kpis.map((k) => (
                    <div key={k.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                        {k.accent && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
                        {k.label}
                      </p>
                      <p className="mt-1 text-2xl font-extrabold text-slate-900">{k.value}</p>
                    </div>
                  ))}
                </div>

                {data.totals.page_views === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
                    <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
                    <p className="mt-1 text-xs text-slate-400">{t("visitorsNoData")}</p>
                  </div>
                ) : (
                  <>
                    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{t("visitorsDaily")}</h3>
                        <span className="flex items-center gap-3 text-[11px] text-slate-500">
                          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-amber-200" />{t("visitorsPageViews")}</span>
                          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-slate-900" />{t("visitorsUnique")}</span>
                        </span>
                      </div>
                      <div className="flex h-36 items-end gap-px">
                        {data.daily.map((d) => (
                          <div
                            key={d.date}
                            className="flex h-full flex-1 flex-col justify-end"
                            title={t("visitorsDayTooltip", { date: d.date, views: d.page_views, visitors: d.visitors })}
                          >
                            <div className="flex w-full flex-col justify-end rounded-t bg-amber-200" style={{ height: `${(d.page_views / maxDaily) * 100}%` }}>
                              <div className="w-full rounded-t bg-slate-900" style={{ height: `${d.page_views ? (d.visitors / d.page_views) * 100 : 0}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                        <span>{data.daily[0]?.date}</span>
                        <span>{data.daily[data.daily.length - 1]?.date}</span>
                      </div>
                    </section>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <h3 className="mb-3 text-sm font-bold text-slate-900">{t("visitorsTopCountries")}</h3>
                        <VisitorBars
                          rows={data.countries.map((c) => ({
                            key: c.key,
                            label: (
                              <>
                                <CountryBadge code={c.key} />
                                {countryName(c.key)}
                              </>
                            ),
                            value: c.visitors,
                          }))}
                          empty={t("visitorsNoLocation")}
                        />
                        <p className="mt-3 text-[11px] text-slate-400">{t("visitorsKnownLocation", { pct: data.totals.location_known_share })}</p>
                      </section>

                      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <h3 className="mb-3 text-sm font-bold text-slate-900">{t("visitorsTopCities")}</h3>
                        <VisitorBars
                          rows={data.cities.map((c) => ({ key: `${c.city}|${c.region}|${c.country_code}`, label: place(c.country_code, c.city, c.region), value: c.visitors }))}
                          empty={t("visitorsNoCity")}
                        />
                        {!data.has_city_data && <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{t("visitorsCityHint")}</p>}
                      </section>

                      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <h3 className="mb-3 text-sm font-bold text-slate-900">{t("visitorsDevices")}</h3>
                        <VisitorBars
                          rows={rows(data.devices, (k) => (t.has(`visitorsDevice_${k}`) ? t(`visitorsDevice_${k}`) : k))}
                          empty={t("visitorsNoData")}
                        />
                      </section>

                      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <h3 className="mb-3 text-sm font-bold text-slate-900">{t("visitorsBrowsers")}</h3>
                        <VisitorBars rows={rows(data.browsers, (k) => k)} empty={t("visitorsNoData")} />
                      </section>

                      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <h3 className="mb-3 text-sm font-bold text-slate-900">{t("visitorsOs")}</h3>
                        <VisitorBars rows={rows(data.operating_systems, (k) => k)} empty={t("visitorsNoData")} />
                      </section>

                      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <h3 className="mb-3 text-sm font-bold text-slate-900">{t("visitorsLanguages")}</h3>
                        <VisitorBars
                          rows={rows(data.languages, (k) => (k === "fr" ? "Français" : k === "en" ? "English" : k))}
                          empty={t("visitorsNoData")}
                        />
                        <p className="mt-3 text-[11px] text-slate-400">{t("visitorsSignedInShare", { pct: data.totals.signed_in_share })}</p>
                      </section>

                      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm md:col-span-2 xl:col-span-2">
                        <h3 className="mb-3 text-sm font-bold text-slate-900">{t("visitorsPages")}</h3>
                        <VisitorBars
                          rows={data.pages.map((p) => ({ key: p.path, label: p.path, value: p.page_views }))}
                          empty={t("visitorsNoData")}
                        />
                      </section>

                      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                        <h3 className="mb-3 text-sm font-bold text-slate-900">{t("visitorsReferrers")}</h3>
                        <VisitorBars rows={rows(data.referrers, (k) => k)} empty={t("visitorsNoReferrers")} />
                      </section>
                    </div>

                    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                      <h3 className="mb-3 text-sm font-bold text-slate-900">{t("visitorsRecent")}</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[34rem] text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              <th className="py-2 pr-3">{t("visitorsColTime")}</th>
                              <th className="py-2 pr-3">{t("visitorsColLocation")}</th>
                              <th className="py-2 pr-3">{t("visitorsColDevice")}</th>
                              <th className="py-2">{t("visitorsColPage")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 text-slate-700">
                            {data.recent.map((v, i) => (
                              <tr key={`${v.created_at}-${i}`}>
                                <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{new Date(v.created_at).toLocaleString()}</td>
                                <td className="py-2 pr-3 font-semibold">{place(v.country_code, v.city, v.region)}</td>
                                <td className="py-2 pr-3">
                                  {t.has(`visitorsDevice_${v.device_type}`) ? t(`visitorsDevice_${v.device_type}`) : v.device_type} · {v.os} · {v.browser}
                                </td>
                                <td className="py-2">
                                  <span className="font-mono text-[11px]">{v.path}</span>
                                  {v.is_signed_in && <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">{t("visitorsSignedInTag")}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )}

                <p className="text-[11px] leading-relaxed text-slate-400 max-w-3xl">{t("visitorsPrivacy", { days: data.retention_days })}</p>
              </>
            )}
          </div>
        );
      })()}

      {/* ================= TAB: AUDIT LOG ================= */}
      {tab === "audit" && isSuperAdmin && (
        <div className="space-y-4 animate-rise-in">
          <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">{t("auditIntro")}</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAuditQuery(auditSearch.trim());
            }}
            className="flex flex-wrap items-end gap-3 pb-3 border-b border-slate-200/80"
          >
            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 grow min-w-[12rem] max-w-sm">
              {t("auditSearch")}
              <input
                type="search"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder={t("auditSearchPlaceholder")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900 focus:outline-none focus:border-amber-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("auditOutcome")}
              <select
                value={auditOutcome}
                onChange={(e) => setAuditOutcome(e.target.value as "" | "failed" | "success")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900 focus:outline-none focus:border-amber-500"
              >
                <option value="">{t("auditOutcomeAll")}</option>
                <option value="success">{t("auditOutcomeSuccess")}</option>
                <option value="failed">{t("auditOutcomeFailed")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("auditSince")}
              <input
                type="date"
                value={auditSince}
                onChange={(e) => setAuditSince(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900 focus:outline-none focus:border-amber-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {t("auditUntil")}
              <input
                type="date"
                value={auditUntil}
                onChange={(e) => setAuditUntil(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900 focus:outline-none focus:border-amber-500"
              />
            </label>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
              {t("auditApply")}
            </button>
          </form>

          <p className="text-xs font-semibold text-slate-500">
            {auditLoading ? t("usersLoading") : t("auditCount", { count: auditCount })}
          </p>

          {auditError ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-rose-200 bg-white">
              <p className="text-sm font-semibold text-rose-700">{t("auditLoadError")}</p>
            </div>
          ) : !auditLoading && auditEntries.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="text-xs text-slate-400 mt-1">{t("auditEmpty")}</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {auditEntries.map((entry) => {
                const slug = entry.action.replace(/[^a-zA-Z0-9]+/g, "_");
                const label = t.has(`audit_${slug}`) ? t(`audit_${slug}`) : entry.action;
                const target =
                  entry.target_label || (entry.target_id ? `${entry.target_type} #${entry.target_id.slice(0, 8)}` : entry.target_type);
                const outcomeLabel = entry.succeeded ? t("auditDone") : entry.status_code === 403 ? t("auditBlocked") : t("auditFailed");
                const outcomeStyle = entry.succeeded
                  ? "bg-emerald-100 text-emerald-800"
                  : entry.status_code === 403
                  ? "bg-amber-100 text-amber-800"
                  : "bg-rose-100 text-rose-800";
                const detailPairs = Object.entries(entry.details).filter(([, value]) => value !== null && value !== "");
                return (
                  <li key={entry.id} className="border border-slate-200/80 rounded-2xl p-4 bg-white shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{label}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${outcomeStyle}`}>{outcomeLabel}</span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          <span className="font-semibold">{entry.actor_username}</span>
                          {target ? <> → <span className="font-semibold">{target}</span></> : null}
                        </p>
                      </div>
                      <div className="text-right text-[11px] text-slate-400">
                        <p>{new Date(entry.created_at).toLocaleString()}</p>
                        {entry.ip_address && <p>{entry.ip_address}</p>}
                      </div>
                    </div>
                    {detailPairs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {detailPairs.map(([key, value]) => (
                          <span key={key} className="rounded-lg bg-slate-50 border border-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                            <span className="font-semibold text-slate-500">{t.has(`auditField_${key}`) ? t(`auditField_${key}`) : key}:</span>{" "}
                            {String(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {auditCount > 0 && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={() => loadAudit(auditPage - 1)}
                disabled={auditPage <= 1 || auditLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("previous")}
              </button>
              <span className="text-xs text-slate-500 font-medium">{t("pageN", { n: auditPage })}</span>
              <button
                onClick={() => loadAudit(auditPage + 1)}
                disabled={!auditHasNext || auditLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("next")}
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
              {t("greetingsTitle")}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              {t("greetingsIntro")} <code className="bg-slate-100 px-1.5 py-0.5 rounded text-amber-600 font-mono text-[11px]">&#123;name&#125;</code> {t("greetingsNamePlaceholderHint")} <code className="bg-slate-100 px-1.5 py-0.5 rounded text-amber-600 font-mono text-[11px]">&#123;month&#125;</code> {t("greetingsMonthPlaceholderHint")}
            </p>

            {!greetingSettings ? (
              <p className="text-sm text-slate-400 py-6 text-center">{t("greetingsLoading")}</p>
            ) : (
              <form onSubmit={handleSaveGreetingSettings} className="space-y-8">
                {/* 1. Happy Birthday Section */}
                <div className="p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">🎂</span>
                      <div>
                        <h4 className="                        text-sm font-bold text-slate-900">{t("birthdayHeading")}</h4>
                                                <p className="text-xs text-slate-500">{t("birthdayHint")}</p>
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
                        {greetingSettings.birthday_enabled ? t("enabled") : t("disabled")}
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      {t("birthdayTitleLabel")}
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
                      {t("birthdayMessageLabel")}
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
                      {t("preview", { text: greetingSettings.birthday_message.replace("{name}", "Sarah") })}
                    </p>
                  </div>
                </div>

                {/* 2. Happy New Month Section */}
                <div className="p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">🗓️</span>
                      <div>
                        <h4 className="                        text-sm font-bold text-slate-900">{t("newMonthHeading")}</h4>
                                                <p className="text-xs text-slate-500">{t("newMonthHint")}</p>
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
                        {greetingSettings.new_month_enabled ? t("enabled") : t("disabled")}
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      {t("newMonthTitleLabel")}
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
                      {t("newMonthMessageLabel")}
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
                      {t("preview", { text: greetingSettings.new_month_message.replace("{name}", "Sarah").replace("{month}", "October") })}
                    </p>
                  </div>
                </div>

                {/* 3. WhatsApp listing share message */}
                <div className="p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 space-y-4">
                  <div className="flex items-center gap-2.5 pb-3 border-b border-slate-200/80">
                    <span className="text-2xl">💬</span>
                    <div>
                      <h4 className="                      text-sm font-bold text-slate-900">{t("shareHeading")}</h4>
                      <p className="text-xs text-slate-500">
                                              {t("shareHint")}
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
                    {t("preview", {
                      text: greetingSettings.listing_share_message
                        .replace("{title}", "house")
                        .replace("{price}", "150,000")
                        .replace("{location}", "Bonamoussadi")
                        .replace("{link}", "https://oaziland.com/en/listing/123"),
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button disabled={savingGreetings} size="lg">
                    {savingGreetings ? t("saving") : t("saveGreetings")}
                  </Button>
                  {greetingSaveSuccess && (
                    <span className="text-xs text-emerald-700 font-bold animate-fade-in flex items-center gap-1">
                      <span>✓</span> {t("greetingsSaved")}
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
      </div>
    </main>
    </DataAdminAccess.Provider>
  );
}
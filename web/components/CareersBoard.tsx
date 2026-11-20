"use client";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  downloadApplicationCv,
  JOB_EMPLOYMENT_TYPES,
  JOB_ROLE_CATEGORIES,
  JOB_WORKPLACE_TYPES,
  listMyJobApplications,
  listMyJobPostings,
  withdrawMyJobApplication,
  type JobApplicationItem,
  type JobPosting,
} from "@/lib/api";
import JobApplyButton from "@/components/JobApplyButton";
import JobPostForm from "@/components/JobPostForm";
import JobPostingManagement from "@/components/JobPostingManagement";
import HideForOwner from "@/components/HideForOwner";
import ReportContentButton from "@/components/ReportContentButton";
import { refreshMyJobApplications, useMyJobApplications } from "@/components/useMyJobApplications";
import {
  IconBriefcase,
  IconBuilding,
  IconCheckCircle,
  IconChevronRight,
  IconClock,
  IconCopy,
  IconCreditCard,
  IconDownload,
  IconFileText,
  IconGraduationCap,
  IconHeart,
  IconMapPin,
  IconShieldCheck,
  IconUsers,
} from "@/components/Icons";

const SAVED_JOBS_KEY = "oaziland_saved_jobs";
const SAVED_JOBS_DATA_KEY = "oaziland_saved_jobs_v2";

const AVATAR_TONES = [
  "bg-slate-900 text-amber-300",
  "bg-emerald-900 text-emerald-100",
  "bg-amber-100 text-amber-950 border border-amber-300",
  "bg-sky-900 text-sky-100",
  "bg-indigo-900 text-indigo-100",
] as const;

function posterInitials(name: string, fallbackTitle: string): string {
  const raw = (name?.trim() || fallbackTitle || "O").replace(/^\s*\[[^\]]*\]\s*/, "");
  const lettersOnly = raw.split(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+/).filter(Boolean);
  if (lettersOnly.length >= 2) return `${lettersOnly[0][0]}${lettersOnly[1][0]}`.toUpperCase();
  return (lettersOnly[0] || "OA").slice(0, 2).toUpperCase();
}

function avatarTone(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

type ViewTab = "browse" | "saved" | "activity";

export default function CareersBoard({
  jobs,
  totalCount,
  filtered,
  initialSelectedId,
  linkedJob,
  missingLinkedJob,
}: {
  jobs: JobPosting[];
  totalCount: number;
  filtered?: boolean;
  initialSelectedId?: string;
  linkedJob?: JobPosting | null;
  missingLinkedJob?: boolean;
}) {
  const t = useTranslations("CareersPage");
  const locale = useLocale();
  const myApplications = useMyJobApplications();

  const mergedJobs = useMemo(() => {
    if (!linkedJob || jobs.some((j) => j.id === linkedJob.id)) return jobs;
    return [linkedJob, ...jobs];
  }, [jobs, linkedJob]);

  const [viewTab, setViewTab] = useState<ViewTab>("browse");
  const [selectedId, setSelectedId] = useState<string>(() => {
    if (initialSelectedId && mergedJobs.some((j) => j.id === initialSelectedId)) return initialSelectedId;
    return mergedJobs[0]?.id ?? "";
  });
  const [mobileDetailOpen, setMobileDetailOpen] = useState<boolean>(() =>
    Boolean(initialSelectedId && mergedJobs.some((j) => j.id === initialSelectedId)),
  );
  const [savedMap, setSavedMap] = useState<Map<string, JobPosting>>(new Map());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  // My applications & posted jobs (loaded on demand when switching to "activity")
  const [activityState, setActivityState] = useState<"idle" | "loading" | "failed" | "ready">("idle");
  const [activityError, setActivityError] = useState("");
  const [myAppItems, setMyAppItems] = useState<JobApplicationItem[]>([]);
  const [myPostings, setMyPostings] = useState<JobPosting[]>([]);
  const [activityReloadKey, setActivityReloadKey] = useState(0);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setSignedIn(Boolean(localStorage.getItem("access_token")));
      try {
        const next = new Map<string, JobPosting>();
        const rawMap = localStorage.getItem(SAVED_JOBS_DATA_KEY);
        if (rawMap) {
          const parsedMap = JSON.parse(rawMap) as unknown;
          if (parsedMap && typeof parsedMap === "object" && !Array.isArray(parsedMap)) {
            for (const [id, item] of Object.entries(parsedMap as Record<string, JobPosting>)) {
              if (item && typeof item.id === "string") next.set(id, item);
            }
          }
        }
        // Migrate legacy ID-only bookmarks when present in the loaded jobs list.
        const rawLegacy = localStorage.getItem(SAVED_JOBS_KEY);
        if (rawLegacy) {
          const parsedLegacy = JSON.parse(rawLegacy) as unknown;
          if (Array.isArray(parsedLegacy)) {
            for (const id of parsedLegacy) {
              if (typeof id === "string" && !next.has(id)) {
                const found = mergedJobs.find((j) => j.id === id);
                if (found) next.set(id, found);
              }
            }
          }
        }
        // Refresh snapshots with latest server data when on the current page.
        for (const job of mergedJobs) {
          if (next.has(job.id)) next.set(job.id, job);
        }
        setSavedMap(next);
      } catch {
        setSavedMap(new Map());
      }
    });
  }, [mergedJobs]);

  useEffect(() => {
    if (viewTab !== "activity") return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    let live = true;
    void Promise.resolve().then(() => setActivityState("loading"));
    Promise.all([listMyJobApplications(token), listMyJobPostings(token)])
      .then(([apps, posts]) => {
        if (!live) return;
        setMyAppItems(apps);
        setMyPostings(posts);
        setActivityState("ready");
      })
      .catch(() => {
        if (live) setActivityState("failed");
      });
    return () => {
      live = false;
    };
  }, [viewTab, activityReloadKey]);

  const visibleJobs = useMemo(
    () => (viewTab === "saved" ? [...savedMap.values()] : mergedJobs),
    [mergedJobs, viewTab, savedMap],
  );

  const activeJob = useMemo(
    () => visibleJobs.find((j) => j.id === selectedId) ?? visibleJobs[0] ?? null,
    [visibleJobs, selectedId],
  );

  function toggleSaved(job: JobPosting) {
    setSavedMap((prev) => {
      const next = new Map(prev);
      if (next.has(job.id)) next.delete(job.id);
      else next.set(job.id, job);
      try {
        localStorage.setItem(SAVED_JOBS_DATA_KEY, JSON.stringify(Object.fromEntries(next)));
        localStorage.setItem(SAVED_JOBS_KEY, JSON.stringify([...next.keys()]));
      } catch {
        // Ignore storage quota errors.
      }
      return next;
    });
  }

  function selectJob(jobId: string) {
    setSelectedId(jobId);
    setMobileDetailOpen(true);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("job", jobId);
      window.history.replaceState(null, "", url.toString());
    }
  }

  async function copyJobLink(jobId: string) {
    if (typeof window === "undefined" || !navigator.clipboard) return;
    const url = new URL(window.location.href);
    url.searchParams.set("job", jobId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopiedId(jobId);
      window.setTimeout(() => setCopiedId((cur) => (cur === jobId ? null : cur)), 2000);
    } catch {
      // Clipboard blocked.
    }
  }

  const formatNumber = (value: string) => Number(value).toLocaleString(locale);
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });

  const roleLabel = (role: string) =>
    (JOB_ROLE_CATEGORIES as readonly string[]).includes(role)
      ? t(`role_${role as (typeof JOB_ROLE_CATEGORIES)[number]}`)
      : role;

  const empTypeLabel = (emp?: string) =>
    emp && (JOB_EMPLOYMENT_TYPES as readonly string[]).includes(emp)
      ? t(`empType_${emp as (typeof JOB_EMPLOYMENT_TYPES)[number]}`)
      : null;

  const workplaceLabel = (wp?: string) =>
    wp && (JOB_WORKPLACE_TYPES as readonly string[]).includes(wp)
      ? t(`workplace_${wp as (typeof JOB_WORKPLACE_TYPES)[number]}`)
      : null;

  const employerDisplayName = (job: JobPosting) =>
    job.company_name?.trim() || job.posted_by_name?.trim() || "Oaziland Partner";

  const locationDisplay = (job: JobPosting) => {
    if (job.quarter_name && job.city_name) return `${job.quarter_name}, ${job.city_name}`;
    if (job.quarter_name) return `${job.quarter_name}, ${t("locationCameroon")}`;
    return t("locationCameroon");
  };

  async function handleWithdraw(applicationId: string) {
    if (!window.confirm(t("withdrawConfirm"))) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setActivityError("");
    try {
      await withdrawMyJobApplication(applicationId, token);
      refreshMyJobApplications();
      setActivityReloadKey((k) => k + 1);
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : t("withdrawFailed"));
    }
  }

  async function handleDownloadOwnCv(app: JobApplicationItem) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setActivityError("");
    try {
      await downloadApplicationCv({ myApplicationId: app.id }, token, app.cv_filename || "cv.pdf");
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : t("cvDownloadFailed"));
    }
  }

  const salaryText = (job: JobPosting) => {
    if (job.salary_min_xaf && job.salary_max_xaf) {
      return t("salaryRange", { min: formatNumber(job.salary_min_xaf), max: formatNumber(job.salary_max_xaf) });
    }
    if (job.salary_min_xaf) return t("salaryFrom", { min: formatNumber(job.salary_min_xaf) });
    if (job.salary_max_xaf) return t("salaryUpTo", { max: formatNumber(job.salary_max_xaf) });
    return null;
  };

  const savedOnPageCount = savedMap.size;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[240px_minmax(0,1fr)] items-start">
      {/* Left LinkedIn-style Job Seeker & Employer Sidebar */}
      <aside className="flex flex-col gap-4 xl:sticky xl:top-20">
        {/* Navigation card */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {t("sidebarWorkspace")}
            </p>
          </div>
          <nav className="flex flex-row xl:flex-col overflow-x-auto p-1.5 gap-1">
            <button
              type="button"
              onClick={() => {
                setViewTab("browse");
                setMobileDetailOpen(false);
              }}
              aria-pressed={viewTab === "browse"}
              className={`flex items-center justify-between gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                viewTab === "browse"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <IconBriefcase size={15} className={viewTab === "browse" ? "text-amber-300" : "text-slate-500"} />
                <span>{t("sidebarBrowseAll")}</span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  viewTab === "browse" ? "bg-white/15 text-amber-300" : "bg-slate-100 text-slate-600"
                }`}
              >
                {totalCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setViewTab("saved");
                setMobileDetailOpen(false);
              }}
              aria-pressed={viewTab === "saved"}
              className={`flex items-center justify-between gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                viewTab === "saved"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <IconHeart
                  size={15}
                  className={
                    viewTab === "saved"
                      ? "fill-amber-300 text-amber-300"
                      : savedOnPageCount > 0
                        ? "fill-amber-500 text-amber-500"
                        : "text-slate-500"
                  }
                />
                <span>{savedOnPageCount > 0 ? t("savedFilter", { count: savedOnPageCount }) : t("sidebarSavedJobs")}</span>
              </span>
              {savedOnPageCount === 0 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">0</span>
              )}
            </button>

            {signedIn && (
              <button
                type="button"
                onClick={() => {
                  setViewTab("activity");
                  setMobileDetailOpen(false);
                }}
                aria-pressed={viewTab === "activity"}
                className={`flex items-center justify-between gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  viewTab === "activity"
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  <IconFileText size={15} className={viewTab === "activity" ? "text-amber-300" : "text-slate-500"} />
                  <span>{t("sidebarMyActivity")}</span>
                </span>
                {myApplications.size > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      viewTab === "activity" ? "bg-white/15 text-amber-300" : "bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {myApplications.size}
                  </span>
                )}
              </button>
            )}
          </nav>
        </div>

        {/* Employer Post-a-Job card */}
        <div className="hidden xl:flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div>
            <p className="text-sm font-black tracking-tight text-slate-900">{t("sidebarEmployerTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{t("sidebarEmployerBody")}</p>
          </div>
          <JobPostForm fullWidth />
        </div>

        {/* Career upskilling / certification promo card */}
        <div className="hidden xl:flex flex-col gap-2.5 rounded-xl border border-amber-200/80 bg-gradient-to-b from-amber-50/80 to-white p-4 shadow-2xs">
          <div className="flex items-center gap-2 text-amber-900">
            <IconGraduationCap size={17} />
            <p className="text-xs font-black tracking-tight">{t("sidebarCoursesTitle")}</p>
          </div>
          <p className="text-xs leading-relaxed text-slate-600">{t("sidebarCoursesBody")}</p>
          <Link
            href="/trainings"
            className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-slate-900 hover:text-amber-800 hover:underline"
          >
            <span>{t("sidebarCoursesCta")}</span>
            <IconChevronRight size={13} />
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0 flex flex-col gap-3">
        {missingLinkedJob && (
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900">
            {t("linkedJobNotFound")}
          </p>
        )}
        {viewTab === "activity" ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xs flex flex-col gap-4">
            {activityError && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">
                {activityError}
              </p>
            )}
            {activityState === "loading" && <p className="text-sm text-slate-500">{t("loadingMine")}</p>}
            {activityState === "failed" && (
              <p role="alert" className="text-sm text-red-600">
                {t("mineLoadFailed")}
              </p>
            )}
            {activityState === "ready" && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <h2 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">
                    {t("myApplications")}
                  </h2>
                  {myAppItems.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                      {t("noApplicationsYet")}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2.5">
                      {myAppItems.map((app) => (
                        <li
                          key={app.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">{app.job_title}</p>
                            <p className="text-xs text-slate-400">
                              {app.company_name ? `${app.company_name} · ` : ""}
                              {formatDate(app.applied_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {app.has_cv && (
                              <button
                                type="button"
                                onClick={() => void handleDownloadOwnCv(app)}
                                className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                <IconDownload size={11} />
                                CV
                              </button>
                            )}
                            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-0.5 text-xs font-bold text-emerald-800">
                              {t(`appStatus_${app.status}`)}
                            </span>
                            {app.status !== "HIRED" && (
                              <button
                                type="button"
                                onClick={() => void handleWithdraw(app.id)}
                                className="text-[11px] font-bold text-red-600 hover:underline cursor-pointer"
                              >
                                {t("withdrawApplication")}
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h2 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">
                    {t("myPostings")}
                  </h2>
                  {myPostings.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                      {t("noPostingsYet")}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2.5">
                      {myPostings.map((job) => (
                        <li key={job.id} className="rounded-xl border border-slate-200 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-bold text-slate-900">{job.title}</p>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                              {job.is_open ? t("applicants", { count: job.application_count }) : t("closedBadge")}
                            </span>
                          </div>
                          <JobPostingManagement
                            jobId={job.id}
                            postedBy={job.posted_by}
                            job={job}
                            isOpen={job.is_open}
                            isOwner
                            onClosed={() => setActivityReloadKey((k) => k + 1)}
                            onUpdated={() => setActivityReloadKey((k) => k + 1)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>
        ) : visibleJobs.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 sm:p-12 shadow-2xs">
            <div className="mx-auto max-w-md text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                <IconBriefcase size={26} />
              </div>
              <h2 className="mt-4 text-lg font-black tracking-tight text-slate-900">
                {viewTab === "saved" ? t("sidebarSavedJobs") : filtered ? t("noJobsMatch") : t("noJobsYet")}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {viewTab === "saved" ? t("noSavedJobs") : t("emptyCtaBody")}
              </p>
              {viewTab !== "saved" && (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <JobPostForm />
                  {filtered && (
                    <Link
                      href="/careers"
                      className="rounded-full border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      {t("clear")}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Master-Detail unified LinkedIn Jobs split container */
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs lg:grid lg:grid-cols-[minmax(320px,5fr)_minmax(0,7fr)] lg:divide-x lg:divide-slate-200">
            {/* Center Column: Scannable Job Feed */}
            <div className={`${mobileDetailOpen ? "hidden lg:flex" : "flex"} flex-col`}>
              <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3.5">
                <h2 className="text-sm font-black tracking-tight text-slate-900">
                  {viewTab === "saved" ? t("sidebarSavedJobs") : t("topPicksTitle")}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t("resultCount", { count: viewTab === "saved" ? visibleJobs.length : totalCount })}
                </p>
              </div>

              <ul
                aria-label={t("title")}
                className="divide-y divide-slate-200/80 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto"
              >
                {visibleJobs.map((job) => {
                  const selected = activeJob?.id === job.id;
                  const pay = salaryText(job);
                  const myStatus = myApplications.get(job.id) ?? job.my_application_status;
                  const saved = savedMap.has(job.id);
                  const location = locationDisplay(job);
                  const poster = employerDisplayName(job);
                  const empBadge = empTypeLabel(job.employment_type);
                  const wpBadge = workplaceLabel(job.workplace_type);

                  return (
                    <li key={job.id} className="relative">
                      <div
                        role="button"
                        tabIndex={0}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => selectJob(job.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectJob(job.id);
                          }
                        }}
                        className={`group relative flex gap-3.5 p-4 text-left transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 ${
                          selected
                            ? "bg-amber-50/55 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-slate-900"
                            : "bg-white hover:bg-slate-50/90"
                        }`}
                      >
                        <div
                          aria-hidden="true"
                          className={`mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xs font-black tracking-tight shadow-2xs ${avatarTone(
                            job.posted_by || job.id,
                          )}`}
                        >
                          {posterInitials(poster, job.title)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3
                              className={`text-[15px] font-bold leading-snug group-hover:underline ${
                                selected ? "text-slate-950" : "text-sky-950"
                              }`}
                            >
                              {job.title}
                            </h3>
                            <button
                              type="button"
                              aria-label={saved ? t("savedJob") : t("saveJob")}
                              aria-pressed={saved}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSaved(job);
                              }}
                              className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
                            >
                              <IconHeart size={16} className={saved ? "fill-amber-500 text-amber-500" : ""} />
                            </button>
                          </div>

                          <p className="mt-0.5 truncate text-xs font-semibold text-slate-800">{poster}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {location}
                            {wpBadge ? ` (${wpBadge})` : ""}
                            {empBadge ? ` · ${empBadge}` : ` · ${roleLabel(job.role_category)}`}
                          </p>

                          {pay && (
                            <p className="mt-1.5 text-xs font-bold text-emerald-800">
                              {pay}
                            </p>
                          )}

                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                            {myStatus ? (
                              <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                <IconCheckCircle size={12} />
                                {t(`appStatus_${myStatus}`)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                                <IconShieldCheck size={12} className="text-amber-600" />
                                {t("easyApplyBadge")}
                              </span>
                            )}
                            <span aria-hidden="true">·</span>
                            <span>{t("postedOn", { date: formatDate(job.posted_at) })}</span>
                            {job.application_count > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-semibold text-emerald-700">
                                  {t("applicants", { count: job.application_count })}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Right Column: Full Job Inspector */}
            {activeJob && (
              <article
                aria-live="polite"
                className={`${
                  mobileDetailOpen ? "block" : "hidden lg:block"
                } lg:max-h-[calc(100vh-8.5rem)] lg:overflow-y-auto`}
              >
                {/* Mobile back bar */}
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5 lg:hidden">
                  <button
                    type="button"
                    onClick={() => setMobileDetailOpen(false)}
                    className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 hover:text-slate-950 cursor-pointer"
                  >
                    <IconChevronRight size={14} className="rotate-180" />
                    {t("backToJobs")}
                  </button>
                </div>

                <div className="p-5 sm:p-7">
                  {/* Employer identity bar */}
                  <div className="flex items-center gap-3">
                    <div
                      aria-hidden="true"
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-black tracking-tight shadow-2xs ${avatarTone(
                        activeJob.posted_by || activeJob.id,
                      )}`}
                    >
                      {posterInitials(employerDisplayName(activeJob), activeJob.title)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {employerDisplayName(activeJob)}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span>{locationDisplay(activeJob)}</span>
                        <span aria-hidden="true">·</span>
                        {activeJob.is_open ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {t("openStatus")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-slate-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                            {t("closedBadge")}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Job Title */}
                  <h2 className="mt-4 text-xl sm:text-2xl font-black tracking-tight text-slate-950 leading-snug">
                    {activeJob.title}
                  </h2>

                  {/* Sub-meta line */}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
                    <span>{t("postedOn", { date: formatDate(activeJob.posted_at) })}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                      <IconUsers size={13} className="text-slate-400" />
                      {activeJob.application_count === 0
                        ? t("beFirstApplicant")
                        : t("applicants", { count: activeJob.application_count })}
                    </span>
                    {activeJob.closes_at && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                          <IconClock size={13} />
                          {t("closesOn", { date: formatDate(activeJob.closes_at) })}
                        </span>
                      </>
                    )}
                  </p>

                  {/* Structured Job Highlights */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800">
                      <IconBriefcase size={13} className="text-slate-500" />
                      {roleLabel(activeJob.role_category)}
                      {empTypeLabel(activeJob.employment_type) ? ` · ${empTypeLabel(activeJob.employment_type)}` : ""}
                      {workplaceLabel(activeJob.workplace_type) ? ` · ${workplaceLabel(activeJob.workplace_type)}` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-xs font-bold text-emerald-900">
                      <IconCreditCard size={13} className="text-emerald-700" />
                      {salaryText(activeJob) ?? t("salaryNotDisclosed")}
                    </span>
                    {activeJob.quarter_name && (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        <IconMapPin size={13} className="text-slate-500" />
                        {locationDisplay(activeJob)}
                      </span>
                    )}
                  </div>

                  {/* Primary Action Row */}
                  <div className="mt-5 flex flex-wrap items-center gap-2.5 border-y border-slate-200/80 py-4">
                    {activeJob.is_open ? (
                      <HideForOwner ownerId={activeJob.posted_by}>
                        <JobApplyButton key={activeJob.id} jobId={activeJob.id} applyLabel={t("apply")} />
                      </HideForOwner>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600">
                        {t("applicationsClosedPill")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleSaved(activeJob)}
                      aria-pressed={savedMap.has(activeJob.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-bold transition-colors cursor-pointer ${
                        savedMap.has(activeJob.id)
                          ? "border-amber-400 bg-amber-50 text-amber-950"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <IconHeart
                        size={14}
                        className={savedMap.has(activeJob.id) ? "fill-amber-500 text-amber-500" : ""}
                      />
                      {savedMap.has(activeJob.id) ? t("savedJob") : t("saveJob")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyJobLink(activeJob.id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <IconCopy size={14} />
                      {copiedId === activeJob.id ? t("linkCopied") : t("copyLink")}
                    </button>
                  </div>

                  {/* About the role */}
                  <section className="mt-6">
                    <h3 className="text-base font-black tracking-tight text-slate-900">
                      {t("aboutRole")}
                    </h3>
                    <div className="mt-3 text-sm leading-relaxed text-slate-700 whitespace-pre-line">
                      {activeJob.description}
                    </div>
                  </section>

                  {/* Employer / Poster Card */}
                  <section className="mt-7 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      {t("hiringTeam")}
                    </p>
                    <div className="mt-2.5 flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-black text-amber-300">
                        <IconBuilding size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">
                          {employerDisplayName(activeJob)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {activeJob.posted_by_name?.trim() && activeJob.company_name?.trim()
                            ? `${activeJob.posted_by_name.trim()} · `
                            : ""}
                          {roleLabel(activeJob.role_category)} · {locationDisplay(activeJob)}
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Poster-only applicant management */}
                  <JobPostingManagement
                    key={`manage-${activeJob.id}`}
                    jobId={activeJob.id}
                    postedBy={activeJob.posted_by}
                    job={activeJob}
                    isOpen={activeJob.is_open}
                  />

                  {/* Subtle Report link */}
                  <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-end">
                    <ReportContentButton
                      kind="job_posting"
                      id={activeJob.id}
                      ownerId={activeJob.posted_by}
                      variant="inline"
                    />
                  </div>
                </div>
              </article>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

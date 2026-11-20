"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import {
  closeJobPosting,
  downloadApplicationCv,
  getMyProfile,
  listJobApplications,
  reopenJobPosting,
  shareJobPostingViaWhatsApp,
  updateJobApplicationStatus,
  type JobApplicationItem,
  type JobPosting,
} from "@/lib/api";
import DirectChatButton from "@/components/DirectChatButton";
import JobPostForm from "@/components/JobPostForm";
import { IconDownload, IconGraduationCap, IconPhoneCall } from "@/components/Icons";

const STATUS_ACTIONS = ["REVIEWED", "SHORTLISTED", "REJECTED", "HIRED"] as const;

/**
 * Poster-only applicant management: review applicants, download private PDF CVs,
 * inspect verified Oaziland certificates, shortlist/reject/hire, share via WhatsApp, edit, and close the job.
 */
export default function JobPostingManagement({
  jobId,
  postedBy,
  job,
  isOpen = true,
  isOwner,
  onClosed,
  onUpdated,
}: {
  jobId: string;
  postedBy: string;
  job?: JobPosting;
  isOpen?: boolean;
  isOwner?: boolean;
  onClosed?: () => void;
  onUpdated?: (job: JobPosting) => void;
}) {
  const t = useTranslations("CareersPage");
  const router = useRouter();
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [applications, setApplications] = useState<JobApplicationItem[] | null>(null);
  const [showApplications, setShowApplications] = useState(false);
  const [sharePhone, setSharePhone] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOwner !== undefined) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyProfile(token)
      .then((p) => setMyUserId(p.id))
      .catch(() => {});
  }, [isOwner]);

  async function run(action: (token: string) => Promise<void>) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setError("");
    setBusy(true);
    try {
      await action(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  const loadApplications = () => run(async (token) => setApplications(await listJobApplications(jobId, token)));

  const handleUpdateStatus = (applicationId: string, newStatus: string) =>
    run(async (token) => {
      await updateJobApplicationStatus(jobId, applicationId, newStatus, token);
      setApplications(await listJobApplications(jobId, token));
    });

  const handleDownloadCv = async (app: JobApplicationItem) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setDownloadingId(app.id);
    setError("");
    try {
      await downloadApplicationCv({ jobId, applicationId: app.id }, token, app.cv_filename || "cv.pdf");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleShare = () =>
    run(async (token) => {
      if (!sharePhone) return;
      const result = await shareJobPostingViaWhatsApp(jobId, sharePhone, token);
      setShareLink(result.deep_link);
    });

  const handleClose = () => {
    if (!window.confirm(t("closeConfirm"))) return;
    void run(async (token) => {
      await closeJobPosting(jobId, token);
      onClosed?.();
      router.refresh();
    });
  };

  const handleReopen = () =>
    run(async (token) => {
      const updated = await reopenJobPosting(jobId, token);
      onUpdated?.(updated);
      onClosed?.();
      router.refresh();
    });

  if (!(isOwner ?? myUserId === postedBy)) return null;

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap items-center">
        <button
          type="button"
          onClick={() => {
            setShowApplications((prev) => !prev);
            if (!applications) void loadApplications();
          }}
          aria-expanded={showApplications}
          className="text-xs font-bold text-slate-800 underline cursor-pointer"
        >
          {showApplications ? t("hideApplications") : t("manageApplications")}
        </button>
        {isOpen && (
          <>
            <input
              aria-label={t("sharePlaceholder")}
              placeholder={t("sharePlaceholder")}
              value={sharePhone}
              onChange={(e) => setSharePhone(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs w-56"
            />
            <button
              type="button"
              onClick={() => void handleShare()}
              disabled={busy || !sharePhone}
              className="text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-lg disabled:opacity-50 cursor-pointer"
            >
              {t("share")}
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {job && <JobPostForm existingJob={job} onSaved={onUpdated} />}
          {isOpen ? (
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="text-xs font-bold border border-red-200 text-red-700 px-3 py-1 rounded-lg hover:bg-red-50 disabled:opacity-50 cursor-pointer"
            >
              {t("closeJob")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleReopen()}
              disabled={busy}
              className="text-xs font-bold border border-emerald-300 bg-emerald-50 text-emerald-900 px-3 py-1 rounded-lg hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"
            >
              {t("reopenJob")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {shareLink && (
        <a href={shareLink} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-700 underline">
          {t("openWhatsApp")}
        </a>
      )}

      {showApplications && applications && (
        <div className="flex flex-col gap-2.5">
          {applications.length === 0 ? (
            <p className="text-xs text-slate-400">{t("noApplications")}</p>
          ) : (
            applications.map((app) => (
              <div
                key={app.id}
                className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/40 flex flex-col gap-2.5"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-black text-slate-900">{app.applicant_name}</p>
                      <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                        {t(`appStatus_${app.status}`)}
                      </span>
                      {app.years_experience !== null && app.years_experience !== undefined && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                          {t("yearsExpShort", { count: app.years_experience })}
                        </span>
                      )}
                    </div>
                    {app.applicant_phone && (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                        <IconPhoneCall size={11} />
                        {app.applicant_phone}
                      </p>
                    )}
                    {app.cover_message && (
                      <p className="mt-1.5 text-xs text-slate-600 break-words whitespace-pre-line">
                        {app.cover_message}
                      </p>
                    )}
                    {app.certificates && app.certificates.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {app.certificates.map((cert) => (
                          <Link
                            key={cert.code}
                            href={`/certificates/${cert.code}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-900 hover:underline"
                          >
                            <IconGraduationCap size={12} />
                            {t("verifiedCertBadge", { title: cert.title })}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {app.has_cv && (
                      <button
                        type="button"
                        onClick={() => void handleDownloadCv(app)}
                        disabled={downloadingId === app.id}
                        className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                      >
                        <IconDownload size={12} />
                        {downloadingId === app.id ? t("downloadingCv") : t("downloadCv")}
                      </button>
                    )}
                    <DirectChatButton
                      recipientId={app.applicant}
                      recipientName={app.applicant_name}
                      label={t("chat")}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap border-t border-slate-200/70 pt-2">
                  {STATUS_ACTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void handleUpdateStatus(app.id, s)}
                      disabled={busy || app.status === s}
                      className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                    >
                      {t(`action_${s}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

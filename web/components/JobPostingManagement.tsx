"use client";
import { useState, useEffect } from "react";
import { listJobApplications, updateJobApplicationStatus, shareJobPostingViaWhatsApp, getMyProfile, type JobApplicationItem } from "@/lib/api";
import DirectChatButton from "@/components/DirectChatButton";

const STATUS_ACTIONS = ["SHORTLISTED", "REJECTED", "HIRED"] as const;

/**
 * Poster-only job management — the real gap this closes: a poster
 * could see who applied (application_count) but had no way to
 * actually shortlist/reject/hire anyone, and no WhatsApp share button
 * existed despite build_whatsapp_action() being reused exactly as
 * the spec required.
 */
export default function JobPostingManagement({ jobId, postedBy }: { jobId: string; postedBy: string }) {
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [applications, setApplications] = useState<JobApplicationItem[] | null>(null);
  const [showApplications, setShowApplications] = useState(false);
  const [sharePhone, setSharePhone] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyProfile(token).then((p) => setMyUserId(p.id)).catch(() => {});
  }, []);

  function loadApplications() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    listJobApplications(jobId, token).then(setApplications).catch(() => {});
  }

  async function handleUpdateStatus(applicationId: string, newStatus: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await updateJobApplicationStatus(jobId, applicationId, newStatus, token);
    loadApplications();
  }

  async function handleShare() {
    const token = localStorage.getItem("access_token");
    if (!token || !sharePhone) return;
    const result = await shareJobPostingViaWhatsApp(jobId, sharePhone, token);
    setShareLink(result.deep_link);
  }

  if (myUserId !== postedBy) return null;

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => { setShowApplications((prev) => !prev); if (!applications) loadApplications(); }}
          className="text-xs font-semibold text-[var(--navy)] underline"
        >
          {showApplications ? "Hide Applications" : "Manage Applications"}
        </button>
        <input
          placeholder="Share via WhatsApp: recipient phone" value={sharePhone} onChange={(e) => setSharePhone(e.target.value)}
          className="border rounded px-2 py-1 text-xs w-56"
        />
        <button onClick={handleShare} className="text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded">
          Share
        </button>
      </div>
      {shareLink && (
        <a href={shareLink} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-700 underline">
          Open WhatsApp share link →
        </a>
      )}

      {showApplications && applications && (
        <div className="flex flex-col gap-2">
          {applications.length === 0 ? (
            <p className="text-xs text-gray-400">No applications yet.</p>
          ) : (
            applications.map((app) => (
              <div key={app.id} className="border rounded-lg p-3 flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-xs font-bold text-gray-800">{app.applicant_name}</p>
                  <p className="text-[11px] text-gray-500">{app.cover_message}</p>
                  <p className="text-[10px] font-bold text-[var(--navy)] mt-1">{app.status}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <DirectChatButton
                    recipientId={app.applicant}
                    recipientName={app.applicant_name}
                    label="Chat"
                    className="text-[10px] font-bold px-2.5 py-1 rounded bg-[var(--navy)] text-white hover:bg-slate-800"
                  />
                  {STATUS_ACTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleUpdateStatus(app.id, s)}
                      disabled={app.status === s}
                      className="text-[10px] font-bold px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-40"
                    >
                      {s}
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

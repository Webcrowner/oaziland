"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { applyToJob } from "@/lib/api";
import { refreshMyJobApplications, useMyJobApplications } from "@/components/useMyJobApplications";
import { IconFileText, IconUpload, IconX } from "@/components/Icons";

const MAX_MESSAGE = 2000;
const MAX_CV_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Interactive job application sheet: lets a candidate attach a private PDF CV (up to 5 MB),
 * state their years of relevant experience, and write a cover message.
 */
export default function JobApplyButton({ jobId, applyLabel }: { jobId: string; applyLabel: string }) {
  const t = useTranslations("CareersPage");
  const router = useRouter();
  const mine = useMyJobApplications();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [coverMessage, setCoverMessage] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "applied" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  const existing = mine.get(jobId);

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf || file.size <= 0 || file.size > MAX_CV_BYTES) {
      setErrorText(t("cvInvalidType"));
      setStatus("error");
      e.target.value = "";
      return;
    }
    setErrorText("");
    if (status === "error") setStatus("idle");
    setCvFile(file);
  }

  async function handleApply() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setStatus("submitting");
    setErrorText("");
    try {
      const parsedYears = yearsExperience.trim() !== "" ? Number.parseInt(yearsExperience, 10) : null;
      await applyToJob(
        jobId,
        {
          coverMessage: coverMessage.trim(),
          yearsExperience: parsedYears !== null && !Number.isNaN(parsedYears) ? parsedYears : null,
          cvFile,
        },
        token,
      );
      setStatus("applied");
      refreshMyJobApplications();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : t("applyFailed"));
      setStatus("error");
      refreshMyJobApplications();
    }
  }

  if (status === "applied") {
    return (
      <p
        role="status"
        className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800"
      >
        ✓ {t("applied")}
      </p>
    );
  }

  if (existing) {
    return (
      <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800">
        ✓ {t("appliedStatus", { status: t(`appStatus_${existing}`) })}
      </p>
    );
  }

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-2.5 text-sm font-bold text-amber-300 shadow-sm hover:bg-slate-800 transition-colors cursor-pointer"
      >
        {applyLabel}
      </button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-slate-50/90 p-4 sm:p-5 flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[1.5fr_1fr]">
        {/* Private PDF CV upload */}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600" htmlFor={`cv-${jobId}`}>
            {t("cvUploadLabel")}
          </label>
          <input
            ref={fileInputRef}
            id={`cv-${jobId}`}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handlePickFile}
            className="sr-only"
          />
          {cvFile ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50/80 px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-2 min-w-0 font-bold text-emerald-900">
                <IconFileText size={15} className="shrink-0 text-emerald-700" />
                <span className="truncate">{cvFile.name}</span>
                <span className="shrink-0 font-medium text-emerald-700/80">
                  ({Math.max(1, Math.round(cvFile.size / 1024))} KB)
                </span>
              </span>
              <button
                type="button"
                aria-label={t("cvRemoveFile")}
                onClick={() => {
                  setCvFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="shrink-0 rounded-full p-1 text-emerald-800 hover:bg-emerald-200/60 cursor-pointer"
              >
                <IconX size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <IconUpload size={14} className="text-slate-500" />
              <span>{t("cvChooseFile")}</span>
            </button>
          )}
          <p className="mt-1 text-[11px] leading-snug text-slate-500">{t("cvUploadHint")}</p>
        </div>

        {/* Years of relevant experience */}
        <div>
          <label
            className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600"
            htmlFor={`exp-${jobId}`}
          >
            {t("yearsExperienceLabel")}
          </label>
          <input
            id={`exp-${jobId}`}
            type="number"
            min={0}
            max={60}
            placeholder={t("yearsExperiencePlaceholder")}
            value={yearsExperience}
            onChange={(e) => setYearsExperience(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15"
          />
        </div>
      </div>

      <div>
        <label
          className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600"
          htmlFor={`cover-${jobId}`}
        >
          {t("coverMessageLabel")}
        </label>
        <textarea
          id={`cover-${jobId}`}
          rows={3}
          maxLength={MAX_MESSAGE}
          placeholder={t("coverMessagePlaceholder")}
          value={coverMessage}
          onChange={(e) => setCoverMessage(e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15"
        />
      </div>

      {status === "error" && (
        <p role="alert" className="text-red-600 text-xs font-medium">
          {errorText}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={status === "submitting"}
          className="rounded-full bg-slate-900 px-5 py-2 text-sm font-bold text-amber-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
        >
          {status === "submitting" ? t("submitting") : t("submitApplication")}
        </button>
        <button
          type="button"
          onClick={() => setShowForm(false)}
          className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
        >
          {t("cancel")}
        </button>
        <span className="ml-auto text-[11px] font-medium text-slate-400">
          {coverMessage.length}/{MAX_MESSAGE}
        </span>
      </div>
    </div>
  );
}

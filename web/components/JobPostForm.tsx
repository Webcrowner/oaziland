"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  createJobPosting,
  JOB_EMPLOYMENT_TYPES,
  JOB_ROLE_CATEGORIES,
  JOB_WORKPLACE_TYPES,
  listQuarters,
  updateJobPosting,
  type JobPosting,
  type Quarter,
} from "@/lib/api";
import { IconBriefcase, IconShieldCheck, IconX } from "@/components/Icons";

const inputCls =
  "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-4 focus:ring-amber-500/15";
const labelCls = "mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600";

let quartersPromise: Promise<Quarter[]> | null = null;

function initialForm(job?: JobPosting) {
  return {
    companyName: job?.company_name ?? "",
    title: job?.title ?? "",
    role: job?.role_category ?? "PROPERTY_MANAGER",
    employmentType: job?.employment_type ?? "FULL_TIME",
    workplaceType: job?.workplace_type ?? "ON_SITE",
    quarter: job?.quarter ?? "",
    description: job?.description ?? "",
    salaryMin: job?.salary_min_xaf ? String(Math.round(Number(job.salary_min_xaf))) : "",
    salaryMax: job?.salary_max_xaf ? String(Math.round(Number(job.salary_max_xaf))) : "",
    closesOn: job?.closes_at ? job.closes_at.slice(0, 10) : "",
  };
}

/**
 * Publishes or edits a KYC-verified job opening from an accessible modal dialog with full professional
 * metadata: company/organization name, employment type, workplace mode, and Cameroon neighborhood.
 */
export default function JobPostForm({
  fullWidth = false,
  existingJob,
  onSaved,
}: {
  fullWidth?: boolean;
  existingJob?: JobPosting;
  onSaved?: (job: JobPosting) => void;
}) {
  const t = useTranslations("CareersPage");
  const router = useRouter();
  const isEdit = Boolean(existingJob);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [kycBlocked, setKycBlocked] = useState(false);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [form, setForm] = useState(() => initialForm(existingJob));

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  useEffect(() => {
    if (!open) return;
    let live = true;
    quartersPromise ??= listQuarters().catch(() => {
      quartersPromise = null;
      return [];
    });
    void quartersPromise.then((rows) => {
      if (live) setQuarters(rows);
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openForm() {
    if (!localStorage.getItem("access_token")) {
      router.push("/login");
      return;
    }
    setForm(initialForm(existingJob));
    setDone(false);
    setError("");
    setKycBlocked(false);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setBusy(true);
    setError("");
    setKycBlocked(false);
    const payload = {
      company_name: form.companyName.trim(),
      title: form.title.trim(),
      role_category: form.role,
      employment_type: form.employmentType,
      workplace_type: form.workplaceType,
      quarter: form.quarter || null,
      description: form.description.trim(),
      salary_min_xaf: form.salaryMin || null,
      salary_max_xaf: form.salaryMax || null,
      closes_at: form.closesOn ? new Date(`${form.closesOn}T23:59:59`).toISOString() : null,
    };
    try {
      const saved = existingJob
        ? await updateJobPosting(existingJob.id, payload, token)
        : await createJobPosting(payload, token);
      if (!existingJob) setForm(initialForm());
      setOpen(false);
      setDone(true);
      onSaved?.(saved);
      router.refresh();
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      const msg = err instanceof Error ? err.message : t("postFailed");
      setError(msg);
      setKycBlocked(!existingJob && (status === 403 || /kyc/i.test(msg)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={fullWidth ? "w-full" : "inline-flex items-center gap-2.5"}>
        {isEdit ? (
          <button
            type="button"
            onClick={openForm}
            className="text-xs font-bold border border-slate-300 bg-white text-slate-700 px-3 py-1 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
          >
            {t("editJob")}
          </button>
        ) : (
          <button
            type="button"
            onClick={openForm}
            className={`${
              fullWidth ? "w-full justify-center" : ""
            } inline-flex items-center gap-2 rounded-full border-2 border-slate-900 bg-slate-900 px-4 py-2 text-xs sm:text-sm font-bold text-amber-300 shadow-xs hover:bg-slate-800 hover:border-slate-800 transition-colors cursor-pointer`}
          >
            <IconBriefcase size={15} />
            <span>{t("postJob")}</span>
          </button>
        )}
        {done && (
          <p role="status" className="text-xs font-semibold text-emerald-700">
            ✓ {t(isEdit ? "updatedOk" : "postedOk")}
          </p>
        )}
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-job-dialog-title"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <form
            onSubmit={submit}
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl flex flex-col gap-4"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-amber-300">
                  <IconBriefcase size={17} />
                </span>
                <div>
                  <h2 id="post-job-dialog-title" className="text-lg font-black tracking-tight text-slate-900">
                    {t(isEdit ? "editJobTitle" : "postJobTitle")}
                  </h2>
                  {!isEdit && (
                    <p className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                      <IconShieldCheck size={12} className="text-emerald-600" />
                      {t("kycRequiredNote")}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                aria-label={t("cancel")}
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 cursor-pointer"
              >
                <IconX size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="job-title">
                  {t("jobTitleLabel")}
                </label>
                <input id="job-title" required maxLength={200} value={form.title} onChange={set("title")} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="job-company">
                  {t("companyNameLabel")}
                </label>
                <input
                  id="job-company"
                  maxLength={150}
                  placeholder={t("companyNamePlaceholder")}
                  value={form.companyName}
                  onChange={set("companyName")}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className={labelCls} htmlFor="job-role">
                  {t("roleLabel")}
                </label>
                <select id="job-role" value={form.role} onChange={set("role")} className={inputCls}>
                  {JOB_ROLE_CATEGORIES.map((role) => (
                    <option key={role} value={role}>
                      {t(`role_${role}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="job-emp-type">
                  {t("employmentTypeLabel")}
                </label>
                <select id="job-emp-type" value={form.employmentType} onChange={set("employmentType")} className={inputCls}>
                  {JOB_EMPLOYMENT_TYPES.map((et) => (
                    <option key={et} value={et}>
                      {t(`empType_${et}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="job-workplace">
                  {t("workplaceTypeLabel")}
                </label>
                <select id="job-workplace" value={form.workplaceType} onChange={set("workplaceType")} className={inputCls}>
                  {JOB_WORKPLACE_TYPES.map((wt) => (
                    <option key={wt} value={wt}>
                      {t(`workplace_${wt}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="job-quarter">
                {t("neighborhoodLabel")}
              </label>
              <select id="job-quarter" value={form.quarter} onChange={set("quarter")} className={inputCls}>
                <option value="">{t("anyNeighborhood")}</option>
                {quarters.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.village_name ? `${q.village_name} — ${q.name}` : q.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="job-description">
                {t("descriptionLabel")}
              </label>
              <textarea id="job-description" required rows={5} value={form.description} onChange={set("description")} className={inputCls} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className={labelCls} htmlFor="job-salary-min">
                  {t("salaryMinLabel")}
                </label>
                <input id="job-salary-min" type="number" min={0} step={1000} value={form.salaryMin} onChange={set("salaryMin")} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="job-salary-max">
                  {t("salaryMaxLabel")}
                </label>
                <input id="job-salary-max" type="number" min={0} step={1000} value={form.salaryMax} onChange={set("salaryMax")} className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="job-closes">
                  {t("closesOnLabel")}
                </label>
                <input
                  id="job-closes"
                  type="date"
                  value={form.closesOn}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={set("closesOn")}
                  className={inputCls}
                />
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                <p>{error}</p>
                {kycBlocked && (
                  <Link
                    href="/kyc"
                    className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-900 px-3.5 py-1 text-xs font-bold text-amber-300 hover:bg-slate-800"
                  >
                    {t("completeKycCta")}
                  </Link>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-slate-900 px-6 py-2 text-sm font-bold text-amber-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {busy ? t(isEdit ? "savingChanges" : "publishing") : t(isEdit ? "saveChanges" : "publish")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

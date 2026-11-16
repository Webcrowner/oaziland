"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { reportRideIssue, RIDE_ISSUE_CATEGORIES, type RideIssueCategory } from "@/lib/api";
import { IconAlertCircle, IconCheckCircle } from "@/components/Icons";
import { inputCls, labelCls, pillBtnCls, solidBtnCls } from "./styles";

const MIN_LENGTH = 10;
const MAX_LENGTH = 1000;

/** "Report a problem" on a trip: the report goes to the Oaziland team, who follow up and reply by notification. */
export default function RideIssueForm({ rideId, isDriver }: { rideId: string; isDriver: boolean }) {
  const t = useTranslations("OaziGoPage");
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<RideIssueCategory | "">("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  // A rider doesn't report their own behaviour, and a driver doesn't report their own.
  const categories = RIDE_ISSUE_CATEGORIES.filter((c) => c !== (isDriver ? "DRIVER_BEHAVIOUR" : "RIDER_BEHAVIOUR"));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !category || busy) return;
    setBusy(true);
    setError("");
    try {
      await reportRideIssue(rideId, { category, description: description.trim() }, token);
      setSent(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
        <IconCheckCircle size={16} className="mt-px shrink-0" /> {t("issueSent")}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-xs font-bold text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline cursor-pointer">
        {t("reportProblem")}
      </button>
    );
  }

  const tooShort = description.trim().length < MIN_LENGTH;

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <p className="mb-1 text-sm font-black text-slate-900">{t("reportProblemTitle")}</p>
      <p className="mb-3 text-xs text-slate-500">{t("reportProblemHint")}</p>
      <label htmlFor={`issue-cat-${rideId}`} className={labelCls}>{t("issueCategoryLabel")}</label>
      <select
        id={`issue-cat-${rideId}`} required value={category} onChange={(e) => setCategory(e.target.value as RideIssueCategory)}
        className={`${inputCls} bg-white`}
      >
        <option value="" disabled>{t("issueCategoryPlaceholder")}</option>
        {categories.map((c) => <option key={c} value={c}>{t(`issueCategory_${c}`)}</option>)}
      </select>
      <label htmlFor={`issue-desc-${rideId}`} className={`${labelCls} mt-3`}>{t("issueDescriptionLabel")}</label>
      <textarea
        id={`issue-desc-${rideId}`} required rows={3} minLength={MIN_LENGTH} maxLength={MAX_LENGTH}
        value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("issueDescriptionPlaceholder")}
        className={`${inputCls} resize-y bg-white`}
      />
      <p className="mt-1 text-right text-[11px] font-semibold text-slate-400">{description.length}/{MAX_LENGTH}</p>
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          <IconAlertCircle size={14} className="mt-px shrink-0" /> {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={!category || tooShort || busy} className={solidBtnCls}>
          {busy ? t("submitting") : t("sendReport")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className={pillBtnCls}>{t("cancel")}</button>
      </div>
    </form>
  );
}

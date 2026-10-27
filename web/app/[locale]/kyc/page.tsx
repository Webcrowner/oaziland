"use client";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { getMyKycStatus, submitKyc, type KycProfile } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import SelfieCamera from "@/components/SelfieCamera";
import { IconAlertCircle, IconCheckCircle, IconClock, IconLock, IconShieldCheck, IconUpload } from "@/components/Icons";

const inputClass =
  "w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all";
const labelClass = "block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5";

function StepCard({ number, title, hint, done, children }: { number: number; title: string; hint: string; done: boolean; children: ReactNode }) {
  return (
    <section className="bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-6 shadow-xs">
      <header className="flex items-start gap-3 mb-5">
        <span
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0 transition-colors ${
            done ? "bg-emerald-500 text-white" : "bg-slate-900 text-white"
          }`}
        >
          {done ? <IconCheckCircle size={18} /> : number}
        </span>
        <div>
          <h2 className="font-extrabold text-slate-900 leading-tight">{title}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function IdUploadTile({
  label, buttonLabel, url, replaceLabel, uploadedLabel, onUploaded, onClear,
}: {
  label: string; buttonLabel: string; url: string; replaceLabel: string; uploadedLabel: string; onUploaded: (url: string) => void; onClear: () => void;
}) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      {url ? (
        <div className="relative h-40 rounded-2xl overflow-hidden border border-emerald-300 bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="w-full h-full object-cover" />
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[11px] font-bold bg-emerald-500 text-white px-2 py-1 rounded-full">
            <IconCheckCircle size={12} /> {uploadedLabel}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="absolute bottom-2 right-2 text-xs font-bold bg-white/95 text-slate-800 px-3 py-1.5 rounded-lg shadow hover:bg-white"
          >
            {replaceLabel}
          </button>
        </div>
      ) : (
        <MediaUploader
          folder="kyc-documents"
          multiple={false}
          accept="image/*"
          onUploaded={(r) => onUploaded(r.url)}
          triggerClassName="flex flex-col items-center justify-center gap-2 h-40 w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-600 text-sm font-bold cursor-pointer hover:border-amber-400 hover:bg-amber-50/50 transition-colors"
          label={
            <>
              <IconUpload size={24} className="text-slate-400" />
              <span>{buttonLabel}</span>
            </>
          }
        />
      )}
    </div>
  );
}

/**
 * KYC submission/status — a real document + live-selfie capture flow,
 * matching how every real identity-verification provider (Smile
 * Identity, Onfido, Persona) actually verifies someone: both sides of
 * a photo ID, plus a LIVE camera selfie (never a gallery upload, which
 * could be an old photo of someone else) — not just a text form nobody
 * could ever independently confirm.
 */
export default function KycPage() {
  const t = useTranslations("KycPage");
  const [kyc, setKyc] = useState<KycProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [legalFullName, setLegalFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [nationalIdNumber, setNationalIdNumber] = useState("");
  const [residentialAddress, setResidentialAddress] = useState("");
  const [idFrontUrl, setIdFrontUrl] = useState("");
  const [idBackUrl, setIdBackUrl] = useState("");
  const [selfieUrl, setSelfieUrl] = useState("");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");
  // Closed by default once a submission is under review — reopening
  // the same editable form right after a successful submit (as if it
  // failed) isn't how any real KYC provider behaves; only a fresh
  // account or a REJECTED submission should land straight in the form.
  const [editing, setEditing] = useState(true);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    getMyKycStatus(token)
      .then((data) => {
        setKyc(data);
        if (data) {
          setLegalFullName(data.legal_full_name);
          setDateOfBirth(data.date_of_birth);
          setNationalIdNumber(data.national_id_number);
          setResidentialAddress(data.residential_address);
          setIdFrontUrl(data.id_document_front_image_url || "");
          setIdBackUrl(data.id_document_back_image_url || "");
          setSelfieUrl(data.selfie_image_url || "");
          setEditing(data.kyc_status === "REJECTED");
        }
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const readyToSubmit = !!(idFrontUrl && idBackUrl && selfieUrl);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (!readyToSubmit) {
      setError(t("imagesRequiredError"));
      setSubmitStatus("error");
      return;
    }
    setError("");
    setSubmitStatus("submitting");
    try {
      const updated = await submitKyc(
        {
          legal_full_name: legalFullName, date_of_birth: dateOfBirth, national_id_number: nationalIdNumber,
          residential_address: residentialAddress, id_document_front_image_url: idFrontUrl,
          id_document_back_image_url: idBackUrl, selfie_image_url: selfieUrl,
        },
        token
      );
      setKyc(updated);
      setSubmitStatus("idle");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
      setSubmitStatus("error");
    }
  }

  if (status === "signedOut") {
    return (
      <AccountSidebarLayout activeHref="/kyc">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto shadow-xs">
          <span className="w-14 h-14 rounded-2xl bg-slate-900 text-amber-400 flex items-center justify-center mx-auto mb-4">
            <IconLock size={26} />
          </span>
          <p className="text-slate-600 mb-4 font-semibold text-sm">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  if (status === "loading") {
    return (
      <AccountSidebarLayout activeHref="/kyc">
        <div className="max-w-3xl flex flex-col gap-4 animate-pulse">
          <div className="h-8 w-64 rounded-xl bg-slate-200" />
          <div className="h-40 rounded-3xl bg-slate-200/70" />
          <div className="h-56 rounded-3xl bg-slate-200/70" />
        </div>
      </AccountSidebarLayout>
    );
  }

  const kycStatus = kyc?.kyc_status;
  const locked = kycStatus === "VERIFIED";
  const showForm = !locked && (!kyc || editing);
  const personalDone = !!(legalFullName.trim() && dateOfBirth && nationalIdNumber.trim() && residentialAddress.trim());
  const docsDone = !!(idFrontUrl && idBackUrl);
  const selfieDone = !!selfieUrl;
  const completed = [personalDone, docsDone, selfieDone].filter(Boolean).length;

  return (
    <AccountSidebarLayout activeHref="/kyc">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2 flex flex-col gap-5">
          {locked && (
            <div className="rounded-3xl p-6 bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 flex items-start gap-4">
              <span className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                <IconShieldCheck size={26} />
              </span>
              <div>
                <h2 className="font-extrabold text-emerald-900 text-lg">{t("status_VERIFIED")}</h2>
                <p className="text-sm text-emerald-800/80 mt-1">{t("alreadyVerified")}</p>
              </div>
            </div>
          )}

          {kycStatus === "PENDING" && !editing && (
            <div className="rounded-3xl p-6 bg-gradient-to-br from-amber-50 to-white border border-amber-200">
              <div className="flex items-start gap-4">
                <span className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center shrink-0">
                  <IconClock size={26} />
                </span>
                <div>
                  <h2 className="font-extrabold text-amber-950 text-lg">{t("pendingTitle")}</h2>
                  <p className="text-sm text-amber-900/80 mt-1">{t("pendingReviewMessage")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-4 text-xs font-bold px-4 py-2 rounded-xl border border-amber-300 bg-white text-amber-900 hover:bg-amber-50"
              >
                {t("editSubmissionButton")}
              </button>
            </div>
          )}

          {kycStatus === "REJECTED" && (
            <div className="rounded-3xl p-6 bg-gradient-to-br from-rose-50 to-white border border-rose-200 flex items-start gap-4">
              <span className="w-12 h-12 rounded-2xl bg-rose-500 text-white flex items-center justify-center shrink-0">
                <IconAlertCircle size={26} />
              </span>
              <div>
                <h2 className="font-extrabold text-rose-900 text-lg">{t("status_REJECTED")}</h2>
                <p className="text-sm text-rose-800/80 mt-1">{t("rejectedBody")}</p>
              </div>
            </div>
          )}

          {showForm && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>{t("progressLabel", { done: completed, total: 3 })}</span>
                  <span>{Math.round((completed / 3) * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 mt-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all duration-500"
                    style={{ width: `${(completed / 3) * 100}%` }}
                  />
                </div>
              </div>

              <StepCard number={1} title={t("stepPersonal")} hint={t("stepPersonalHint")} done={personalDone}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className={labelClass}>{t("legalFullName")}</label>
                    <input required value={legalFullName} onChange={(e) => setLegalFullName(e.target.value)} className={inputClass} autoComplete="name" />
                  </div>
                  <div>
                    <label className={labelClass}>{t("dateOfBirth")}</label>
                    <input required type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} autoComplete="bday" />
                  </div>
                  <div>
                    <label className={labelClass}>{t("nationalIdNumber")}</label>
                    <input required value={nationalIdNumber} onChange={(e) => setNationalIdNumber(e.target.value)} className={inputClass} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>{t("residentialAddress")}</label>
                    <textarea required rows={2} value={residentialAddress} onChange={(e) => setResidentialAddress(e.target.value)} className={inputClass} autoComplete="street-address" />
                  </div>
                </div>
              </StepCard>

              <StepCard number={2} title={t("stepDocuments")} hint={t("stepDocumentsHint")} done={docsDone}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <IdUploadTile
                    label={t("idFrontLabel")} buttonLabel={t("uploadIdFrontButton")} replaceLabel={t("replaceButton")} uploadedLabel={t("uploadedBadge")}
                    url={idFrontUrl} onUploaded={setIdFrontUrl} onClear={() => setIdFrontUrl("")}
                  />
                  <IdUploadTile
                    label={t("idBackLabel")} buttonLabel={t("uploadIdBackButton")} replaceLabel={t("replaceButton")} uploadedLabel={t("uploadedBadge")}
                    url={idBackUrl} onUploaded={setIdBackUrl} onClear={() => setIdBackUrl("")}
                  />
                </div>
              </StepCard>

              <StepCard number={3} title={t("stepSelfie")} hint={t("stepSelfieHint")} done={selfieDone}>
                <SelfieCamera folder="kyc-selfies" capturedUrl={selfieUrl} onUploaded={(r) => setSelfieUrl(r.url)} />
              </StepCard>

              {submitStatus === "error" && (
                <p className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3" role="alert">
                  <IconAlertCircle size={16} className="shrink-0" /> {error}
                </p>
              )}
              <Button size="lg" className="w-full" disabled={submitStatus === "submitting" || !readyToSubmit}>
                {submitStatus === "submitting" ? t("submitting") : kyc ? t("resubmitButton") : t("submitButton")}
              </Button>
            </form>
          )}
        </div>

        <aside className="xl:sticky xl:top-6 bg-slate-950 text-slate-300 rounded-3xl p-6 shadow-xl shadow-slate-950/20">
          <span className="w-11 h-11 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center mb-4">
            <IconShieldCheck size={22} />
          </span>
          <h3 className="font-extrabold text-white text-base mb-3">{t("whyTitle")}</h3>
          <ul className="flex flex-col gap-2.5 text-sm">
            {(["why1", "why2", "why3"] as const).map((key) => (
              <li key={key} className="flex items-start gap-2.5">
                <IconCheckCircle size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-2 text-xs text-slate-400 mt-5 pt-4 border-t border-slate-800">
            <IconLock size={14} className="mt-0.5 shrink-0" />
            <span>{t("privacyNote")}</span>
          </p>
        </aside>
      </div>
    </AccountSidebarLayout>
  );
}

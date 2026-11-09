"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getMyVerificationRequests,
  submitMyVerificationRequest,
  type MyVerificationOption,
  type MyVerificationRequest,
} from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import PageHeader from "@/components/ui/PageHeader";
import MediaUploader from "@/components/MediaUploader";
import { Link } from "@/i18n/navigation";
import { IconCheckCircle, IconClock, IconShieldCheck, IconUpload } from "@/components/Icons";

const statusStyle: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
};

/** Where an agent, agency, landlord, hostel or guest-house owner, or a seller asks for a verified mark. */
export default function VerificationPage() {
  const t = useTranslations("VerificationPage");
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [options, setOptions] = useState<MyVerificationOption[]>([]);
  const [requests, setRequests] = useState<MyVerificationRequest[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async (accessToken: string) => {
    try {
      const data = await getMyVerificationRequests(accessToken);
      setOptions(data.options || []);
      setRequests(data.results || []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("access_token");
    void Promise.resolve().then(() => {
      setToken(stored);
      if (stored) void load(stored);
      else setReady(true);
    });
  }, [load]);

  const available = options.filter((o) => o.status === "" || o.status === "REJECTED");
  const choice = available.find((o) => `${o.request_type}:${o.subject_id}` === selected) ?? null;
  const typeLabel = (value: string) => (t.has(`type_${value}`) ? t(`type_${value}`) : value);
  const notice = message && (
    <p className={`rounded-xl px-3 py-2 text-sm font-semibold ${message.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
      {message.text}
    </p>
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !choice || !documentUrl || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await submitMyVerificationRequest(
        { request_type: choice.request_type, subject_id: choice.subject_id, supporting_document_url: documentUrl },
        token
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setMessage({ kind: "error", text: typeof body?.detail === "string" ? body.detail : t("submitFailed") });
        return;
      }
      setMessage({ kind: "ok", text: t("submitted") });
      setSelected("");
      setDocumentUrl("");
      await load(token);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <AccountSidebarLayout activeHref="/verification">
        <p className="p-8 text-sm text-slate-500">{t("loading")}</p>
      </AccountSidebarLayout>
    );
  }

  if (!token) {
    return (
      <AccountSidebarLayout activeHref="/verification">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">{t("signInRequired")}</p>
          <Link href="/login" className="mt-3 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
            {t("signIn")}
          </Link>
        </div>
      </AccountSidebarLayout>
    );
  }

  return (
    <AccountSidebarLayout activeHref="/verification">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {failed && <p className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{t("loadError")}</p>}

      <section className="mb-6 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-6">
        <h2 className="font-extrabold text-slate-900">{t("newRequest")}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t("newRequestHint")}</p>

        {available.length === 0 ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
              {options.length === 0 ? t("nothingToVerify") : t("allRequested")}
            </p>
            {notice}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">{t("whatToVerify")}</span>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-amber-500 focus:outline-none"
                required
              >
                <option value="">{t("choose")}</option>
                {available.map((o) => (
                  <option key={`${o.request_type}:${o.subject_id}`} value={`${o.request_type}:${o.subject_id}`}>
                    {typeLabel(o.request_type)} — {t.has(`role_${o.title}`) ? t(`role_${o.title}`) : o.title}
                    {o.status === "REJECTED" ? ` (${t("resubmit")})` : ""}
                  </option>
                ))}
              </select>
            </label>

            {choice && t.has(`docHint_${choice.request_type}`) && <p className="text-xs text-slate-600">{t(`docHint_${choice.request_type}`)}</p>}

            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">{t("document")}</span>
              {documentUrl ? (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <IconCheckCircle size={18} className="text-emerald-600" />
                  <a href={documentUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-800 underline">
                    {t("documentUploaded")}
                  </a>
                  <button type="button" onClick={() => setDocumentUrl("")} className="ml-auto text-xs font-bold text-slate-600 hover:underline">
                    {t("replace")}
                  </button>
                </div>
              ) : (
                <MediaUploader
                  folder="verification-documents"
                  multiple={false}
                  accept="image/*"
                  onUploaded={(r) => setDocumentUrl(r.url)}
                  triggerClassName="flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-sm font-bold text-slate-600 transition-colors hover:border-amber-400 hover:bg-amber-50/50"
                  label={
                    <>
                      <IconUpload size={22} className="text-slate-400" />
                      <span>{t("uploadDocument")}</span>
                    </>
                  }
                />
              )}
            </div>

            {notice}

            <button
              type="submit"
              disabled={!choice || !documentUrl || busy}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t("sending") : t("send")}
            </button>
          </form>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-6">
        <h2 className="font-extrabold text-slate-900">{t("myRequests")}</h2>
        {requests.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t("noRequests")}</p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {requests.map((r) => (
              <li key={r.id} className="rounded-2xl border border-slate-100 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === "APPROVED" ? (
                    <IconShieldCheck size={16} className="text-emerald-600" />
                  ) : (
                    <IconClock size={16} className="text-slate-400" />
                  )}
                  <span className="text-sm font-bold text-slate-900">{typeLabel(r.request_type)}</span>
                  {r.subject.title && r.subject.kind !== "user" && <span className="text-sm text-slate-600">· {r.subject.title}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyle[r.status] ?? "bg-slate-100 text-slate-700"}`}>
                    {t(`status_${r.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{t("sentOn", { date: new Date(r.submitted_at).toLocaleDateString() })}</p>
                {r.status === "REJECTED" && r.rejection_reason && (
                  <p className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-900">
                    <span className="font-bold">{t("reason")}:</span> {r.rejection_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AccountSidebarLayout>
  );
}

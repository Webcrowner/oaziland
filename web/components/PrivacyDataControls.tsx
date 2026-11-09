"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  cancelMyAccountDeletion,
  downloadMyDataExport,
  getMyAccountDeletion,
  listMyDataExports,
  requestMyAccountDeletion,
  requestMyDataExport,
  type MyAccountDeletion,
  type MyDataExport,
} from "@/lib/api";

/** "Download my data" and "Delete my account", for the privacy settings page. */
export default function PrivacyDataControls({ token }: { token: string }) {
  const t = useTranslations("PrivacySettingsPage");
  const [exports, setExports] = useState<MyDataExport[]>([]);
  const [deletion, setDeletion] = useState<MyAccountDeletion | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [deletionMessage, setDeletionMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");

  const load = useCallback(async () => {
    try {
      const [exportData, deletionData] = await Promise.all([listMyDataExports(token), getMyAccountDeletion(token)]);
      setExports(exportData.results || []);
      setDeletion(deletionData);
    } catch {
      setExportMessage({ ok: false, text: t("privacyLoadError") });
    }
  }, [token, t]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function detail(res: Response, fallback: string) {
    const body = await res.json().catch(() => null);
    return typeof body?.detail === "string" ? body.detail : fallback;
  }

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    setExportMessage(null);
    try {
      const res = await requestMyDataExport(token);
      setExportMessage(res.ok ? { ok: true, text: t("exportReady") } : { ok: false, text: await detail(res, t("exportFailed")) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(item: MyDataExport) {
    try {
      const blob = await downloadMyDataExport(item.id, token);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `oaziland-data-${item.requested_at.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      await load();
    } catch {
      setExportMessage({ ok: false, text: t("exportGone") });
      await load();
    }
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password || !typedMatches) return;
    setBusy(true);
    setDeletionMessage(null);
    try {
      const res = await requestMyAccountDeletion(password, reason.trim(), typed.trim(), token);
      if (!res.ok) {
        setDeletionMessage({ ok: false, text: await detail(res, t("deleteFailed")) });
        return;
      }
      setConfirming(false);
      setPassword("");
      setReason("");
      setTyped("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await cancelMyAccountDeletion(token);
      setDeletionMessage(res.ok ? { ok: true, text: t("deleteCancelled") } : { ok: false, text: await detail(res, t("deleteFailed")) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");
  const note = (message: { ok: boolean; text: string } | null) =>
    message && (
      <p className={`mt-3 rounded-xl px-3.5 py-2.5 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>
    );
  const scheduled = deletion?.status === "REQUESTED";
  const confirmationText = deletion?.confirmation_text ?? "";
  const typedMatches = Boolean(confirmationText) && typed.trim() === confirmationText;

  return (
    <>
      <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-black tracking-tight text-slate-900">{t("exportTitle")}</h2>
        <p className="mb-4 text-sm text-slate-500">{t("exportDescription")}</p>
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {t("exportButton")}
        </button>
        {note(exportMessage)}
        {exports.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100">
            {exports.slice(0, 5).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="font-semibold text-slate-800">{t("exportRequestedOn", { date: date(item.requested_at) })}</span>
                <span className="text-xs text-slate-500">
                  {item.downloadable ? t("exportAvailableUntil", { date: date(item.expires_at) }) : t(`exportStatus_${item.status}`)}
                </span>
                {item.downloadable && (
                  <button
                    type="button"
                    onClick={() => handleDownload(item)}
                    className="ml-auto cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    {t("exportDownload")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-rose-200/80 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-base font-black tracking-tight text-rose-800">{t("deleteTitle")}</h2>
        <p className="mb-4 text-sm text-slate-500">{t("deleteDescription", { days: deletion?.retention_days ?? 30 })}</p>

        {deletion && deletion.blockers.length > 0 && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-bold">{t("deleteBlockedTitle")}</p>
            <ul className="mt-1 list-disc pl-5">
              {deletion.blockers.map((code) => (
                <li key={code}>{t.has(`deleteBlocker_${code}`) ? t(`deleteBlocker_${code}`) : code}</li>
              ))}
            </ul>
          </div>
        )}

        {deletion?.status === "CANCELLED" && deletion.cancelled_by_team && (
          <p className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {t("deleteStoppedByTeam", { reason: deletion.cancellation_reason })}
          </p>
        )}

        {scheduled ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm font-bold text-rose-900">{t("deleteScheduled", { date: date(deletion?.scheduled_for ?? null) })}</p>
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="mt-3 cursor-pointer rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-800 hover:bg-rose-50 disabled:opacity-50"
            >
              {t("deleteCancel")}
            </button>
          </div>
        ) : confirming ? (
          <form onSubmit={handleDelete} className="space-y-3">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <p className="font-bold">{t("deleteWarningTitle")}</p>
              <p className="mt-1">{t("deleteWarningBody")}</p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">{t("deleteTypeToConfirm")}</span>
              <code className="mb-2 inline-block select-all rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-sm text-slate-900">{confirmationText}</code>
              <input
                type="text"
                value={typed}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
                aria-invalid={typed.length > 0 && !typedMatches}
                className={`w-full rounded-xl border px-3.5 py-2.5 font-mono text-sm focus:outline-none ${
                  typedMatches ? "border-emerald-400 focus:border-emerald-500" : "border-slate-200 focus:border-rose-400"
                }`}
                required
              />
              {typed.length > 0 && !typedMatches && <span className="mt-1 block text-xs text-rose-700">{t("deleteTypeMismatch")}</span>}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">{t("deleteReason")}</span>
              <textarea
                value={reason}
                maxLength={500}
                rows={2}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-rose-400 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-600">{t("deletePassword")}</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-rose-400 focus:outline-none"
                required
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy || !password || !typedMatches}
                className="cursor-pointer rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {t("deleteConfirm")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setTyped("");
                  setPassword("");
                }}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {t("deleteKeep")}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="cursor-pointer rounded-xl border border-rose-300 px-4 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-50"
          >
            {t("deleteStart")}
          </button>
        )}
        {note(deletionMessage)}
      </section>
    </>
  );
}

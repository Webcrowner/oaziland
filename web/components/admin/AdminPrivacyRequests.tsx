"use client";
import DataAdminLink, { dataAdminPath } from "@/components/admin/DataAdminLink";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  cancelAdminAccountDeletion,
  completeAdminAccountDeletion,
  listAdminAccountDeletions,
  listAdminDataExports,
  type AdminAccountDeletion,
  type AdminDataExport,
} from "@/lib/api";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
  isSuperAdmin: boolean;
  onChanged: () => void;
}

type DeletionState = "scheduled" | "blocked" | "completed" | "cancelled";
type ExportState = "all" | "ready" | "expired" | "failed";

/** Account deletions (with what still holds them up) and data-export activity. Admins never see export files. */
export default function AdminPrivacyRequests({ token, dialogs, isSuperAdmin, onChanged }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [section, setSection] = useState<"deletions" | "exports">("deletions");
  const [deletionState, setDeletionState] = useState<DeletionState>("scheduled");
  const [exportState, setExportState] = useState<ExportState>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [deletions, setDeletions] = useState<AdminAccountDeletion[]>([]);
  const [exportsList, setExportsList] = useState<AdminDataExport[]>([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (section === "deletions") {
        const data = await listAdminAccountDeletions({ state: deletionState, q: query, page }, token);
        setDeletions(data.results || []);
        setCount(data.count || 0);
        setHasNext(Boolean(data.next));
      } else {
        const data = await listAdminDataExports({ state: exportState, q: query, page }, token);
        setExportsList(data.results || []);
        setCount(data.count || 0);
        setHasNext(Boolean(data.next));
      }
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [section, deletionState, exportState, query, page, token]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function finish(res: Response) {
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      await dialogs.notify(typeof body?.detail === "string" ? body.detail : t("actionFailed"));
    }
    await load();
    onChanged();
  }

  async function handleComplete(item: AdminAccountDeletion) {
    const typed = await dialogs.ask(t("privacyDeleteNowConfirm", { name: item.user.name || item.user.username, username: item.user.username }), {
      required: true,
      placeholder: item.user.username,
      confirmLabel: t("privacyDeleteNow"),
      validate: (value) => (value.trim() === item.user.username ? null : t("privacyDeleteTypeMismatch")),
    });
    if (typed === null) return;
    setBusyId(item.id);
    try {
      await finish(await completeAdminAccountDeletion(item.id, typed.trim(), token));
    } finally {
      setBusyId(null);
    }
  }

  async function handleStop(item: AdminAccountDeletion) {
    const reason = await dialogs.ask(t("privacyStopPrompt", { name: item.user.name || item.user.username }), {
      multiline: true,
      required: true,
      confirmLabel: t("privacyStop"),
      validate: (value) => (value.trim().length > 300 ? t("verifyReasonTooLong") : null),
    });
    if (reason === null) return;
    setBusyId(item.id);
    try {
      await finish(await cancelAdminAccountDeletion(item.id, reason.trim(), token));
    } finally {
      setBusyId(null);
    }
  }

  const pill = (active: boolean) =>
    `rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`;
  const subPill = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${active ? "bg-amber-500 text-slate-950" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`;
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

  return (
    <div className="space-y-4 animate-rise-in">
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("privacyIntro")}</p>

      <div className="flex flex-wrap gap-2">
        {(["deletions", "exports"] as const).map((value) => (
          <button
            key={value}
            onClick={() => {
              setSection(value);
              setPage(1);
            }}
            className={pill(section === value)}
          >
            {t(`privacySection_${value}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200/80 pb-3">
        {section === "deletions"
          ? (["scheduled", "blocked", "completed", "cancelled"] as const).map((value) => (
              <button
                key={value}
                onClick={() => {
                  setDeletionState(value);
                  setPage(1);
                }}
                className={subPill(deletionState === value)}
              >
                {t(`privacyDeletionState_${value}`)}
              </button>
            ))
          : (["all", "ready", "expired", "failed"] as const).map((value) => (
              <button
                key={value}
                onClick={() => {
                  setExportState(value);
                  setPage(1);
                }}
                className={subPill(exportState === value)}
              >
                {t(`privacyExportState_${value}`)}
              </button>
            ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
        className="flex max-w-xl gap-2"
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("privacySearchPlaceholder")}
          className="min-w-0 grow rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none"
        />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
          {t("auditApply")}
        </button>
      </form>

      <p className="text-xs font-semibold text-slate-500">{loading ? t("usersLoading") : t("contentCount", { count })}</p>

      {failed ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-rose-700">{t("privacyLoadError")}</p>
        </div>
      ) : !loading && count === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
        </div>
      ) : section === "deletions" ? (
        <ul className="space-y-2.5">
          {deletions.map((item) => {
            const overdue = item.overdue;
            return (
              <li key={item.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900">
                      {item.user.name || item.user.username} <span className="font-medium text-slate-500">@{item.user.username}</span>
                    </p>
                    {(item.user.phone || item.user.email) && (
                      <p className="text-xs text-slate-500">{[item.user.phone, item.user.email].filter(Boolean).join(" · ")}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {t("privacyRequestedOn", { date: date(item.requested_at) })}
                      {item.status === "REQUESTED" && ` · ${t(overdue ? "privacyOverdue" : "privacyScheduledFor", { date: date(item.scheduled_for) })}`}
                      {item.status === "COMPLETED" && ` · ${t("privacyDeletedOn", { date: date(item.completed_at) })}`}
                    </p>
                    {item.reason && <p className="mt-1 text-xs italic text-slate-600">“{item.reason}”</p>}
                    <DataAdminLink path={dataAdminPath.deletionRequest(item.id)} className="mt-1" />
                    {item.blockers.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.blockers.map((code) => (
                          <span key={code} className="rounded-lg bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                            {t.has(`privacyBlocker_${code}`) ? t(`privacyBlocker_${code}`) : code}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.status === "CANCELLED" && (
                      <p className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                        {item.cancelled_by
                          ? t("privacyStoppedBy", { name: item.cancelled_by, reason: item.cancellation_reason })
                          : t("privacyCancelledByUser")}
                      </p>
                    )}
                  </div>
                  {item.status === "REQUESTED" && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        onClick={() => handleStop(item)}
                        disabled={busyId === item.id}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {t("privacyStop")}
                      </button>
                      {isSuperAdmin && (
                        <button
                          onClick={() => handleComplete(item)}
                          disabled={busyId === item.id || item.blockers.length > 0}
                          title={item.blockers.length > 0 ? t("privacyBlockedHint") : undefined}
                          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t("privacyDeleteNow")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="space-y-2">
          {exportsList.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 text-sm shadow-sm">
              <span className="font-bold text-slate-900">
                {item.user.name} <span className="font-medium text-slate-500">@{item.user.username}</span>
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">{t(`privacyExportStatus_${item.status}`)}</span>
              <span className="text-xs text-slate-500">
                {t("privacyRequestedOn", { date: date(item.requested_at) })}
                {item.downloaded_at ? ` · ${t("privacyDownloadedOn", { date: date(item.downloaded_at) })}` : ` · ${t("privacyNotDownloaded")}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {count > 0 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("previous")}
          </button>
          <span className="text-xs font-medium text-slate-500">{t("pageN", { n: page })}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || loading}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}

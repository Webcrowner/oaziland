"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  keepAdminAiFlaggedContent,
  listAdminAiFlags,
  removeAdminAiFlaggedContent,
  type AdminAiFlag,
  type AdminAiFlagState,
} from "@/lib/api";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
  /** Lets the console refresh its counters after an item is reviewed. */
  onChanged: () => void;
}

/** Posts and listings the automated moderation flagged. They are still live until an admin decides. */
export default function AdminAiFlagsQueue({ token, dialogs, onChanged }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [state, setState] = useState<AdminAiFlagState>("pending");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminAiFlag[]>([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminAiFlags(state, page, token);
      setItems(data.results || []);
      setCount(data.count || 0);
      setHasNext(Boolean(data.next));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [state, page, token]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function readError(res: Response) {
    const body = await res.json().catch(() => null);
    return typeof body?.detail === "string" ? body.detail : t("actionFailed");
  }

  async function finish(res: Response) {
    if (!res.ok) await dialogs.notify(await readError(res));
    await load();
    onChanged();
  }

  async function handleKeep(item: AdminAiFlag) {
    if (!(await dialogs.confirm(t("aiFlagKeepConfirm", { title: item.title }), { confirmLabel: t("aiFlagKeep") }))) return;
    setBusyId(item.id);
    try {
      await finish(await keepAdminAiFlaggedContent(item.type, item.id, token));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(item: AdminAiFlag) {
    const answer = await dialogs.askWithOption(t("contentRemovePrompt", { title: item.title }), {
      multiline: true,
      required: true,
      confirmLabel: t("contentRemove"),
      optionLabel: t("aiFlagAlsoStrike"),
      validate: (value) => (value.trim().length > 500 ? t("contentReasonTooLong") : null),
    });
    if (!answer) return;
    setBusyId(item.id);
    try {
      await finish(await removeAdminAiFlaggedContent(item.type, item.id, answer.value, answer.checked, token));
    } finally {
      setBusyId(null);
    }
  }

  const pill = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
      active ? "bg-amber-500 text-slate-950" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    }`;

  const label = (prefix: string, key: string) => (t.has(`${prefix}_${key}`) ? t(`${prefix}_${key}`) : key);

  return (
    <div className="space-y-4 animate-rise-in">
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("aiFlagIntro")}</p>

      <div className="flex flex-wrap gap-2 border-b border-slate-200/80 pb-3">
        {(["pending", "reviewed"] as const).map((value) => (
          <button
            key={value}
            onClick={() => {
              setState(value);
              setPage(1);
            }}
            className={pill(state === value)}
          >
            {t(`aiFlagState_${value}`)}
          </button>
        ))}
      </div>

      <p className="text-xs font-semibold text-slate-500">{loading ? t("usersLoading") : t("contentCount", { count })}</p>

      {failed ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-rose-700">{t("contentLoadError")}</p>
        </div>
      ) : !loading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
          <p className="mt-1 text-xs text-slate-400">{t(state === "pending" ? "aiFlagEmptyPending" : "aiFlagEmptyReviewed")}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={`${item.type}-${item.id}`} className={`rounded-2xl border bg-white p-4 shadow-sm ${item.escalated && state === "pending" ? "border-rose-200" : "border-slate-200/80"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words text-sm font-bold text-slate-900">{item.title}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{t(`contentType_${item.type}`)}</span>
                    {item.escalated && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">{t("aiFlagEscalated")}</span>
                    )}
                    {item.removed && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">{t("aiFlagAlreadyRemoved")}</span>
                    )}
                  </div>
                  {item.excerpt && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.excerpt}</p>}
                  <p className="mt-1.5 text-xs text-slate-500">
                    {t("contentBy")} <span className="font-semibold text-slate-700">{item.owner_name}</span> · @{item.owner_username} ·{" "}
                    {t("aiFlagFlaggedOn", { date: new Date(item.flagged_at).toLocaleString() })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.flags.map((flag, index) => (
                      <span key={index} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                        <span className="font-semibold text-slate-700">{label("aiFlagCategory", flag.category)}</span> ·{" "}
                        {Math.round(Number(flag.confidence) * 100)}% · {label("aiFlagAction", flag.action)}
                      </span>
                    ))}
                  </div>
                  {item.review && (
                    <p className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                      {t(item.review.outcome === "REMOVED" ? "aiFlagReviewedRemoved" : "aiFlagReviewedKept", { name: item.review.reviewed_by || "—" })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {item.path && !item.removed && (
                    <Link href={item.path} target="_blank" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200">
                      {t("contentOpen")}
                    </Link>
                  )}
                  {state === "pending" && (
                    <>
                      <button
                        onClick={() => handleKeep(item)}
                        disabled={busyId === item.id}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {t("aiFlagKeep")}
                      </button>
                      {!item.removed && (
                        <button
                          onClick={() => handleRemove(item)}
                          disabled={busyId === item.id}
                          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                        >
                          {t("contentRemove")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
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

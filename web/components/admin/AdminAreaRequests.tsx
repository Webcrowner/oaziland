"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  approveAdminAreaRequest,
  listAdminAreaRequests,
  rejectAdminAreaRequest,
  type AdminAreaRequest,
  type AdminAreaRequestStatus,
} from "@/lib/api";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
  /** Lets the console refresh its counters after a request is reviewed. */
  onChanged: () => void;
}

const FILTERS: AdminAreaRequestStatus[] = ["pending", "approved", "rejected"];

function RequestCard({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: AdminAreaRequest;
  busy: boolean;
  onApprove: (names: { area_name: string; city_name: string }) => void;
  onReject: () => void;
}) {
  const t = useTranslations("AdminConsolePage");
  const [area, setArea] = useState(item.area_name);
  const [city, setCity] = useState(item.city_name);
  const pending = item.status === "PENDING";
  const fieldClass =
    "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none";

  return (
    <li className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {pending ? (
            <div className="grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {t("areaName")}
                <input value={area} maxLength={100} onChange={(e) => setArea(e.target.value)} className={`${fieldClass} mt-1`} />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {t("areaCity")}
                <input value={city} maxLength={100} onChange={(e) => setCity(e.target.value)} className={`${fieldClass} mt-1`} />
              </label>
            </div>
          ) : (
            <p className="text-sm font-bold text-slate-900">
              {item.area_name} <span className="font-medium text-slate-500">· {item.city_name}</span>
            </p>
          )}
          <p className="text-xs text-slate-500">
            {t("areaRegion", { region: item.region_name })}
            {item.requested_by ? (
              <>
                {" · "}
                {t("areaRequestedBy")} <span className="font-semibold text-slate-700">{item.requested_by.name}</span> · @{item.requested_by.username}
              </>
            ) : null}
            {" · "}
            {new Date(item.created_at).toLocaleDateString()}
          </p>
          {pending && item.similar.length > 0 && (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              <span className="font-bold">{t("areaSimilar")}:</span> {item.similar.map((q) => `${q.name} (${q.city})`).join(", ")}
            </p>
          )}
          {item.status === "APPROVED" && (
            <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900">
              {t("areaApprovedAs", { name: item.quarter_name || item.area_name, admin: item.reviewed_by || "—" })}
            </p>
          )}
          {item.status === "REJECTED" && (
            <p className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs text-rose-900">
              <span className="font-bold">{t("areaDeclinedBy", { admin: item.reviewed_by || "—" })}:</span> {item.rejection_reason}
            </p>
          )}
        </div>
        {pending && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => onApprove({ area_name: area.trim(), city_name: city.trim() })}
              disabled={busy || !area.trim() || !city.trim()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {t("areaApprove")}
            </button>
            <button
              onClick={onReject}
              disabled={busy}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {t("areaDecline")}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Neighbourhood requests from listers: approve (fixing the spelling if needed) or decline with a reason. */
export default function AdminAreaRequests({ token, dialogs, onChanged }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [status, setStatus] = useState<AdminAreaRequestStatus>("pending");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminAreaRequest[]>([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminAreaRequests({ status, q: query, page }, token);
      setItems(data.results || []);
      setCount(data.count || 0);
      setHasNext(Boolean(data.next));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [status, query, page, token]);

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

  async function handleApprove(item: AdminAreaRequest, names: { area_name: string; city_name: string }) {
    setBusyId(item.id);
    try {
      await finish(await approveAdminAreaRequest(item.id, names, token));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(item: AdminAreaRequest) {
    const reason = await dialogs.ask(t("areaDeclinePrompt", { name: item.area_name }), {
      multiline: true,
      required: true,
      confirmLabel: t("areaDecline"),
      validate: (value) => (value.trim().length > 300 ? t("areaReasonTooLong") : null),
    });
    if (reason === null) return;
    setBusyId(item.id);
    try {
      await finish(await rejectAdminAreaRequest(item.id, reason.trim(), token));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4 animate-rise-in">
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("areaIntro")}</p>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 pb-3">
        {FILTERS.map((value) => (
          <button
            key={value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
              status === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t(`areaFilter_${value}`)}
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
          placeholder={t("areaSearchPlaceholder")}
          className="min-w-0 grow rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none"
        />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
          {t("auditApply")}
        </button>
      </form>

      <p className="text-xs font-semibold text-slate-500">{loading ? t("usersLoading") : t("contentCount", { count })}</p>

      {failed ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-rose-700">{t("areaLoadError")}</p>
        </div>
      ) : !loading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
          <p className="mt-1 text-xs text-slate-400">{t(`areaEmpty_${status}`)}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <RequestCard
              key={`${item.id}-${item.status}`}
              item={item}
              busy={busyId === item.id}
              onApprove={(names) => handleApprove(item, names)}
              onReject={() => handleReject(item)}
            />
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

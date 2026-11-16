"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getAdminMarketplaceReturnsSummary,
  listAdminMarketplaceReturns,
  type AdminReturnRow,
  type AdminReturnState,
  type AdminReturnsSummary,
} from "@/lib/api";

interface Props {
  token: string;
  /** Opens the Disputes tab, where an escalated return is decided. */
  onOpenDisputes: () => void;
}

const STATES: AdminReturnState[] = ["waiting", "escalated", "rejected", "accepted", "closed", "all"];

const statusStyle: Record<string, string> = {
  REQUESTED: "bg-sky-100 text-sky-800",
  ACCEPTED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
  ESCALATED: "bg-amber-200 text-amber-900",
  WITHDRAWN: "bg-slate-200 text-slate-700",
  CLOSED: "bg-slate-200 text-slate-700",
};

const xaf = (value: string | number) => Number(value).toLocaleString();

/** Every buyer return or refund request on the marketplace, read-only, so support can see what is waiting, rejected or escalated. */
export default function AdminReturns({ token, onOpenDisputes }: Props) {
  const t = useTranslations("AdminConsolePage");
  const tr = useTranslations("OrderReturn");
  const [state, setState] = useState<AdminReturnState>("waiting");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<AdminReturnsSummary | null>(null);
  const [items, setItems] = useState<AdminReturnRow[]>([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getAdminMarketplaceReturnsSummary(token));
    } catch {
      setSummary(null);
    }
  }, [token]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminMarketplaceReturns({ state, q: query, page }, token);
      setItems(data.results || []);
      setCount(data.count || 0);
      setHasNext(Boolean(data.next));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [state, query, page, token]);

  useEffect(() => {
    void Promise.resolve().then(loadSummary);
  }, [loadSummary]);
  useEffect(() => {
    void Promise.resolve().then(loadList);
  }, [loadList]);

  const age = (hours: number) => (hours >= 48 ? t("returnsAgeDays", { days: Math.floor(hours / 24) }) : t("returnsAgeHours", { hours: Math.max(0, Math.floor(hours)) }));
  const chipCount = (value: AdminReturnState) => (summary ? (value === "all" ? summary.total : summary[value]) : null);
  const chip = (active: boolean) =>
    `inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition-colors ${
      active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`;
  const switchTo = (value: AdminReturnState) => {
    setState(value);
    setPage(1);
  };

  return (
    <div className="space-y-4 animate-rise-in">
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("returnsIntro")}</p>

      <div className="flex flex-wrap gap-2">
        {STATES.map((value) => {
          const n = chipCount(value);
          return (
            <button key={value} onClick={() => switchTo(value)} className={chip(state === value)} aria-pressed={state === value}>
              {t(`returnsState_${value}`)}
              {n !== null && <span className={`rounded-full px-1.5 text-[11px] ${state === value ? "bg-white/20" : "bg-white text-slate-700"}`}>{n}</span>}
            </button>
          );
        })}
        {summary && summary.waiting_over_48h > 0 && (
          <button
            onClick={() => switchTo("waiting")}
            className="inline-flex min-h-10 items-center rounded-xl bg-amber-200 px-3 text-xs font-bold text-amber-900 hover:bg-amber-300"
          >
            {t("returnsOver48h", { count: summary.waiting_over_48h })}
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
        className="flex gap-2 sm:max-w-md"
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("returnsSearchPlaceholder")}
          aria-label={t("returnsSearchPlaceholder")}
          className="min-h-10 min-w-0 grow rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none"
        />
        <button type="submit" className="min-h-10 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800">
          {t("auditApply")}
        </button>
      </form>

      <p className="text-xs font-semibold text-slate-500">{loading ? t("usersLoading") : t("contentCount", { count })}</p>

      {failed ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-rose-700">{t("returnsLoadError")}</p>
        </div>
      ) : !loading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
          <p className="mt-1 text-xs text-slate-400">{t("returnsEmpty")}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((row) => (
            <li key={row.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 break-words text-sm font-bold text-slate-900">{row.order.listing_title}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyle[row.status] ?? "bg-slate-100 text-slate-700"}`}>
                  {tr(`status_${row.status}`)}
                </span>
              </div>
              <p className="mt-1.5 break-words text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{row.buyer.name} (@{row.buyer.username})</span> → {row.seller.name} (@{row.seller.username})
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{tr(`kind_${row.kind}`)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{tr(`reason_${row.reason}`)}</span>
                {row.requested_amount_xaf && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-800">{t("returnsRequestedAmount", { amount: xaf(row.requested_amount_xaf) })}</span>
                )}
                <span className={`rounded-full px-2 py-0.5 ${row.status === "REQUESTED" && row.age_hours >= 48 ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-600"}`}>
                  {t("returnsAge", { age: age(row.age_hours) })}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                {t("returnsOrderLine", { amount: xaf(row.order.amount_xaf), quantity: row.order.quantity })} · {new Date(row.created_at).toLocaleString()}
              </p>
              {row.description && <p className="mt-2 break-words text-xs leading-relaxed text-slate-700">{row.description}</p>}
              {row.evidence_urls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.evidence_urls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block h-14 w-14 overflow-hidden rounded-lg border border-slate-200 bg-slate-50" aria-label={tr("evidenceAlt")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={tr("evidenceAlt")} className="h-full w-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
              <p className="mt-2 break-words rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span className="font-bold text-slate-700">{tr("sellerNote")}</span> {row.seller_note || t("returnsNoSellerNote")}
              </p>
              {row.status === "REQUESTED" && row.respond_by && (
                <p className="mt-1.5 text-[11px] text-slate-500">{t("returnsRespondBy", { date: new Date(row.respond_by).toLocaleString() })}</p>
              )}
              {row.dispute_id && (
                <button onClick={onOpenDisputes} className="mt-2 inline-flex min-h-10 items-center rounded-lg border border-rose-100 bg-rose-50 px-3 text-[11px] font-bold text-rose-800 hover:bg-rose-100">
                  {t("returnsDispute", { id: row.dispute_id.slice(0, 8) })}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {count > 0 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="min-h-10 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("previous")}
          </button>
          <span className="text-xs font-medium text-slate-500">{t("pageN", { n: page })}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || loading}
            className="min-h-10 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}

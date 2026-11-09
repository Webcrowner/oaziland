"use client";
import DataAdminLink, { dataAdminPath } from "@/components/admin/DataAdminLink";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getAdminPaymentsSummary,
  listAdminPayments,
  type AdminPayment,
  type AdminPaymentState,
  type AdminPaymentsSummary,
} from "@/lib/api";

interface Props {
  token: string;
  /** Opens the Disputes tab, where held money in dispute is decided. */
  onOpenDisputes: () => void;
}

const BOOKING_TYPES = [
  "MARKETPLACE_ITEM",
  "SERVICE_REQUEST",
  "RIDE",
  "HOTEL",
  "EVENT",
  "GUEST_HOUSE",
  "HOSTEL_SEMESTER",
  "GENERAL_RENTAL",
  "LAND_RESERVATION",
];
const STATES: AdminPaymentState[] = ["all", "held", "disputed", "released", "refunded", "failed", "processing"];
const PERIODS = [7, 30, 90, 365];

const stateStyle: Record<string, string> = {
  HELD: "bg-sky-100 text-sky-800",
  RELEASED: "bg-emerald-100 text-emerald-800",
  REFUNDED: "bg-slate-200 text-slate-700",
  DISPUTED: "bg-rose-100 text-rose-800",
  PAYMENT_FAILED: "bg-rose-100 text-rose-800",
  PAYMENT_PROCESSING: "bg-amber-100 text-amber-800",
};

const xaf = (value: string | number) => Number(value).toLocaleString();

/** Every payment on the platform by service: where the money is, who paid, who gets it, and what is stuck. */
export default function AdminPayments({ token, onOpenDisputes }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<AdminPaymentsSummary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);

  const [type, setType] = useState("");
  const [state, setState] = useState<AdminPaymentState>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminPayment[]>([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getAdminPaymentsSummary(days, token));
      setSummaryFailed(false);
    } catch {
      setSummaryFailed(true);
    }
  }, [days, token]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminPayments({ type, state, q: query, since, until, page }, token);
      setItems(data.results || []);
      setCount(data.count || 0);
      setHasNext(Boolean(data.next));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [type, state, query, since, until, page, token]);

  useEffect(() => {
    void Promise.resolve().then(loadSummary);
  }, [loadSummary]);
  useEffect(() => {
    void Promise.resolve().then(loadList);
  }, [loadList]);

  const typeLabel = (value: string) => (t.has(`paymentType_${value}`) ? t(`paymentType_${value}`) : value);
  const person = (p: AdminPayment["requester"]) => (p ? `${p.name} (@${p.username})` : "—");
  const fieldClass =
    "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none";
  const pill = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
      active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`;

  const attention = summary?.attention;
  const totals = summary?.totals;

  return (
    <div className="space-y-5 animate-rise-in">
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("paymentsIntro")}</p>

      {attention && (attention.stuck > 0 || attention.failed_24h > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <span className="font-bold">{t("paymentsAttention")}:</span>
          {attention.stuck > 0 && (
            <button onClick={() => { setState("processing"); setPage(1); }} className="rounded-lg bg-amber-200 px-2.5 py-1 font-bold hover:bg-amber-300">
              {t("paymentsStuck", { count: attention.stuck })}
            </button>
          )}
          {attention.failed_24h > 0 && (
            <button onClick={() => { setState("failed"); setPage(1); }} className="rounded-lg bg-amber-200 px-2.5 py-1 font-bold hover:bg-amber-300">
              {t("paymentsFailed", { count: attention.failed_24h })}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("paymentsPeriod")}</span>
        {PERIODS.map((value) => (
          <button key={value} onClick={() => setDays(value)} className={pill(days === value)}>
            {t("paymentsDays", { days: value })}
          </button>
        ))}
      </div>

      {summaryFailed ? (
        <p className="rounded-2xl border border-dashed border-rose-200 bg-white p-6 text-center text-xs font-semibold text-rose-700">{t("paymentsLoadError")}</p>
      ) : totals ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {(
              [
                ["paymentsHeld", totals.held_xaf, "text-sky-700"],
                ["paymentsDisputed", totals.disputed_xaf, "text-rose-700"],
                ["paymentsReleased", totals.released_xaf, "text-emerald-700"],
                ["paymentsRefunded", totals.refunded_xaf, "text-slate-700"],
                ["paymentsFees", totals.fees_xaf, "text-amber-700"],
              ] as const
            ).map(([key, value, color]) => (
              <div key={key} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t(key)}</p>
                <p className={`mt-1 text-xl font-black ${color}`}>
                  {xaf(value)} <span className="text-xs font-medium text-slate-400">XAF</span>
                </p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">{t("paymentsColService")}</th>
                  <th className="px-3 py-2.5 text-right">{t("paymentsColCount")}</th>
                  <th className="px-3 py-2.5 text-right">{t("paymentsColVolume")}</th>
                  <th className="px-3 py-2.5 text-right">{t("paymentsHeld")}</th>
                  <th className="px-3 py-2.5 text-right">{t("paymentsDisputed")}</th>
                  <th className="px-4 py-2.5 text-right">{t("paymentsFees")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.by_type.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">{t("paymentsNoneInPeriod")}</td>
                  </tr>
                ) : (
                  summary.by_type.map((row) => (
                    <tr key={row.booking_type} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 font-semibold text-slate-800">
                        <button onClick={() => { setType(row.booking_type); setPage(1); }} className="text-left underline-offset-2 hover:underline">
                          {typeLabel(row.booking_type)}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right">{row.count}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">{xaf(row.gross_xaf)}</td>
                      <td className="px-3 py-2.5 text-right text-sky-700">{xaf(row.held_xaf)}</td>
                      <td className="px-3 py-2.5 text-right text-rose-700">{xaf(row.disputed_xaf)}</td>
                      <td className="px-4 py-2.5 text-right text-amber-700">{xaf(row.fees_xaf)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-xs font-semibold text-slate-500">{t("usersLoading")}</p>
      )}

      <div className="space-y-3 border-t border-slate-200/80 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {t("paymentsFilterService")}
            <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className={fieldClass}>
              <option value="">{t("paymentsAllServices")}</option>
              {BOOKING_TYPES.map((value) => (
                <option key={value} value={value}>{typeLabel(value)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {t("auditSince")}
            <input type="date" value={since} onChange={(e) => { setSince(e.target.value); setPage(1); }} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {t("auditUntil")}
            <input type="date" value={until} onChange={(e) => { setUntil(e.target.value); setPage(1); }} className={fieldClass} />
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(search.trim());
            }}
            className="flex min-w-[14rem] grow gap-2 sm:max-w-md"
          >
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("paymentsSearchPlaceholder")}
              className={`${fieldClass} min-w-0 grow`}
            />
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
              {t("auditApply")}
            </button>
          </form>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATES.map((value) => (
            <button key={value} onClick={() => { setState(value); setPage(1); }} className={pill(state === value)}>
              {t(`paymentsState_${value}`)}
            </button>
          ))}
        </div>

        <p className="text-xs font-semibold text-slate-500">{loading ? t("usersLoading") : t("contentCount", { count })}</p>

        {failed ? (
          <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
            <p className="text-sm font-semibold text-rose-700">{t("paymentsLoadError")}</p>
          </div>
        ) : !loading && items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
            <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
            <p className="mt-1 text-xs text-slate-400">{t("paymentsEmpty")}</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {items.map((p) => {
              const shown = p.escrow ? p.escrow.status : p.status;
              return (
                <li key={p.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 break-words text-sm font-bold text-slate-900">{p.title}</p>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{typeLabel(p.booking_type)}</span>
                        {p.note && (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                            {t.has(`paymentNote_${p.note}`) ? t(`paymentNote_${p.note}`) : p.note}
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${stateStyle[shown] ?? "bg-slate-100 text-slate-700"}`}>
                          {t.has(`paymentStatus_${shown}`) ? t(`paymentStatus_${shown}`) : shown}
                        </span>
                        {p.stuck && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">{t("paymentStuckBadge")}</span>}
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">{person(p.requester)}</span> → {person(p.payee)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {new Date(p.created_at).toLocaleString()}
                        {p.escrow?.provider_reference ? ` · ${p.escrow.provider} · ${p.escrow.provider_reference}` : ""}
                      </p>
                      <DataAdminLink path={dataAdminPath.booking(p.id)} className="mt-1" />
                      {p.dispute && (
                        <button onClick={onOpenDisputes} className="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-1 text-[11px] font-bold text-rose-800 hover:bg-rose-100">
                          {t("paymentDispute", { status: p.dispute.status })}
                        </button>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-black text-slate-900">
                        {xaf(p.amount_xaf)} <span className="text-[10px] font-medium text-slate-400">{p.currency}</span>
                      </p>
                      {p.escrow && (
                        <p className="text-[11px] text-slate-500">
                          {t("paymentFee", { fee: xaf(p.escrow.fee_xaf) })} · {t("paymentPayee", { amount: xaf(p.escrow.payee_xaf) })}
                          {Number(p.escrow.refunded_xaf) > 0 && p.escrow.status === "RELEASED" && (
                            <> · {t("paymentRefundedPart", { amount: xaf(p.escrow.refunded_xaf) })}</>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {count > 0 && (
          <div className="flex items-center justify-between gap-3 pt-1">
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
    </div>
  );
}

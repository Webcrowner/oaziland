"use client";
import { useEffect, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  downloadSellerSalesCsv, getSellerDashboard, getSellerPayouts,
  type SellerDashboard, type SellerPayoutRow, type SellerPeriod,
} from "@/lib/api";
import { feeBreakdown } from "@/lib/marketplaceOrderFlow";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import SellerSalesChart from "@/components/SellerSalesChart";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";

const PERIODS: SellerPeriod[] = ["7d", "30d", "90d", "365d", "all"];

type Payouts = { count: number; next: string | null; previous: string | null; results: SellerPayoutRow[] };
type Result<T> = T | Error | null;

function token() {
  return localStorage.getItem("access_token");
}

/** The seller's sales dashboard: earnings, fees, sales over time, categories, best listings and the payout history with a CSV export. */
export default function SellerDashboardPage() {
  const t = useTranslations("SellerDashboard");
  const format = useFormatter();
  const locale = useLocale();
  const [period, setPeriod] = useState<SellerPeriod>("30d");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  const [dashboard, setDashboard] = useState<SellerDashboard | null>(null);
  const [payouts, setPayouts] = useState<Payouts | null>(null);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [error, setError] = useState("");
  const [payoutsError, setPayoutsError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const accessToken = token();
    const request: Promise<Result<SellerDashboard>> = accessToken ? getSellerDashboard(period, accessToken).catch((err: unknown) => err as Error) : Promise.resolve(null);
    request.then((result) => {
      if (cancelled) return;
      if (result === null) setState("signedOut");
      else {
        if (result instanceof Error) setError(result.message || t("loadFailed"));
        else setDashboard(result);
        setState("ready");
      }
    });
    return () => { cancelled = true; };
  }, [period, t]);

  useEffect(() => {
    let cancelled = false;
    const accessToken = token();
    const request: Promise<Result<Payouts>> = accessToken ? getSellerPayouts(period, page, accessToken).catch((err: unknown) => err as Error) : Promise.resolve(null);
    request.then((result) => {
      if (cancelled || result === null) return;
      if (result instanceof Error) setPayoutsError(result.message || t("payoutsFailed"));
      else setPayouts(result);
      setPayoutsLoading(false);
    });
    return () => { cancelled = true; };
  }, [period, page, t]);

  function choosePeriod(value: SellerPeriod) {
    if (value === period) return;
    setPeriod(value);
    setPage(1);
    setState("loading");
    setPayoutsLoading(true);
    setError("");
    setPayoutsError("");
  }

  function changePage(next: number) {
    setPage(next);
    setPayoutsLoading(true);
    setPayoutsError("");
  }

  async function exportCsv() {
    const accessToken = token();
    if (!accessToken) return;
    setExporting(true);
    setPayoutsError("");
    try {
      await downloadSellerSalesCsv(period, accessToken);
    } catch (err) {
      setPayoutsError(err instanceof Error ? err.message : t("exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  const money = (value: string | number) => `${new Intl.NumberFormat(locale).format(Number(value) || 0)} XAF`;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  function kpi(label: string, value: string, hint?: string, highlight = false) {
    return (
      <div key={label} className={`rounded-2xl border p-4 ${highlight ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-xl font-black tracking-tight text-slate-900">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
    );
  }

  function content(data: SellerDashboard) {
    const { summary } = data;
    const fees = feeBreakdown(summary);
    return (
      <div className="flex flex-col gap-6">
        {data.returns.open > 0 && (
          <Link href="/marketplace/orders" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100">
            {t("openReturns", { count: data.returns.open })}
          </Link>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {kpi(t("kpiNet"), money(summary.net_earnings_xaf), undefined, true)}
          {kpi(t("kpiGross"), money(summary.gross_sales_xaf))}
          {kpi(t("kpiFees"), money(summary.platform_fees_xaf), t("kpiFeesHint", { pct: format.number(fees.feePct) }))}
          {kpi(t("kpiEscrow"), money(summary.held_in_escrow_xaf), t("kpiEscrowHint"))}
          {kpi(t("kpiWallet"), money(summary.wallet_balance_xaf))}
          {kpi(t("kpiCompleted"), String(summary.orders_completed), t("kpiOrdersHint", { open: summary.orders_open, cancelled: summary.orders_cancelled }))}
          {kpi(t("kpiItems"), String(summary.items_sold))}
          {kpi(t("kpiAverage"), money(summary.average_order_xaf))}
          {kpi(t("kpiViews"), format.number(summary.listing_views), summary.conversion_pct === null ? t("conversionNone") : t("conversion", { pct: format.number(summary.conversion_pct) }))}
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-bold text-slate-900">{t("chartTitle")}</h2>
          <SellerSalesChart series={data.series} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-bold text-slate-900">{t("feesTitle")}</h2>
          <dl className="max-w-md text-sm">
            <div className="flex justify-between py-1"><dt className="text-slate-600">{t("feesGross")}</dt><dd className="font-semibold text-slate-900">{money(fees.gross)}</dd></div>
            <div className="flex justify-between py-1"><dt className="text-slate-600">{t("feesPlatform", { pct: format.number(fees.feePct) })}</dt><dd className="font-semibold text-red-700">− {money(fees.fees)}</dd></div>
            <div className="flex justify-between py-1"><dt className="text-slate-600">{t("feesRefunds")}</dt><dd className="font-semibold text-red-700">− {money(fees.refunded)}</dd></div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-2"><dt className="font-bold text-slate-900">{t("feesNet")}</dt><dd className="font-black text-emerald-700">{money(fees.net)}</dd></div>
          </dl>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-lg font-bold text-slate-900">{t("categoriesTitle")}</h2>
            {data.by_category.length === 0 ? <p className="text-sm text-slate-500">{t("noSales")}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1 pr-3">{t("colCategory")}</th><th className="py-1 pr-3 text-right">{t("colOrders")}</th><th className="py-1 pr-3 text-right">{t("colGross")}</th><th className="py-1 text-right">{t("colNet")}</th></tr></thead>
                  <tbody>
                    {data.by_category.map((row) => (
                      <tr key={row.category} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3 font-medium text-slate-800">{t(`category_${row.category}`)}</td>
                        <td className="py-1.5 pr-3 text-right">{row.orders}</td>
                        <td className="py-1.5 pr-3 text-right">{money(row.gross_xaf)}</td>
                        <td className="py-1.5 text-right font-semibold">{money(row.net_xaf)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-lg font-bold text-slate-900">{t("topTitle")}</h2>
            {data.top_listings.length === 0 ? <p className="text-sm text-slate-500">{t("noSales")}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1 pr-3">{t("colListing")}</th><th className="py-1 pr-3 text-right">{t("colOrders")}</th><th className="py-1 text-right">{t("colGross")}</th></tr></thead>
                  <tbody>
                    {data.top_listings.map((row) => (
                      <tr key={row.listing_id} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3">
                          <Link href={`/marketplace/${row.category}/${row.listing_id}`} className="font-medium text-[var(--navy)] hover:underline">{row.title}</Link>
                        </td>
                        <td className="py-1.5 pr-3 text-right">{row.orders}</td>
                        <td className="py-1.5 text-right font-semibold">{money(row.gross_xaf)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <AccountSidebarLayout activeHref="/marketplace/dashboard">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">{t("title")}</h1>
        <div className="flex items-center gap-4">
          <Link href="/marketplace/orders" className="text-sm font-semibold text-[var(--navy)] underline">{t("orders")}</Link>
          <Link href="/marketplace/my-listings" className="text-sm font-semibold text-[var(--navy)] underline">{t("listings")}</Link>
        </div>
      </div>

      {state === "signedOut" ? (
        <EmptyState icon="🔒" title={t("signIn")} action={<Button href="/login">{t("signInButton")}</Button>} />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label={t("period")}>
            {PERIODS.map((value) => (
              <button
                key={value} onClick={() => choosePeriod(value)} aria-pressed={period === value}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold cursor-pointer ${period === value ? "bg-[var(--navy)] text-white" : "bg-slate-100 text-slate-700"}`}
              >
                {t(`period_${value}`)}
              </button>
            ))}
          </div>

          {error && <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

          {state === "loading" ? <p className="text-slate-400">...</p> : dashboard && content(dashboard)}

          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-900">{t("payoutsTitle")}</h2>
              <Button variant="secondary" onClick={exportCsv} disabled={exporting}>{exporting ? t("exporting") : t("exportCsv")}</Button>
            </div>
            {payoutsError && <p role="alert" className="mb-3 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{payoutsError}</p>}
            {payoutsLoading ? <p className="text-slate-400">...</p> : !payouts || payouts.results.length === 0 ? (
              <p className="text-sm text-slate-500">{t("payoutsEmpty")}</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-500">
                        <th className="py-1 pr-3">{t("colDate")}</th><th className="py-1 pr-3">{t("colListing")}</th><th className="py-1 pr-3">{t("colBuyer")}</th>
                        <th className="py-1 pr-3 text-right">{t("colQuantity")}</th><th className="py-1 pr-3 text-right">{t("colGross")}</th><th className="py-1 pr-3 text-right">{t("colFee")}</th>
                        <th className="py-1 pr-3 text-right">{t("colRefunded")}</th><th className="py-1 text-right">{t("colNet")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.results.map((row) => (
                        <tr key={row.order_id} className="border-t border-slate-100">
                          <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">{date(row.paid_at)}</td>
                          <td className="py-1.5 pr-3 font-medium text-slate-800">{row.listing_title}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{row.buyer_name}</td>
                          <td className="py-1.5 pr-3 text-right">{row.quantity}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 text-right">{money(row.gross_xaf)}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 text-right">{money(row.fee_xaf)}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 text-right">{money(row.refunded_xaf)}</td>
                          <td className="whitespace-nowrap py-1.5 text-right font-semibold">{money(row.net_xaf)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <Button variant="secondary" disabled={!payouts.previous || payoutsLoading} onClick={() => changePage(page - 1)}>{t("previous")}</Button>
                  <span className="text-xs text-slate-500">{t("pageOf", { page, total: payouts.count })}</span>
                  <Button variant="secondary" disabled={!payouts.next || payoutsLoading} onClick={() => changePage(page + 1)}>{t("next")}</Button>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </AccountSidebarLayout>
  );
}

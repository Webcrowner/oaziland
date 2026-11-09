"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getAdminAnalytics, type AdminAnalytics, type AdminAnalyticsMetric } from "@/lib/api";

const PERIODS = [7, 30, 90, 365];
const MONEY = new Set(["payment_volume_xaf", "fees_earned_xaf", "refunded_xaf", "payouts_xaf"]);
// For these, a rise is bad news, so the arrow turns red.
const RISE_IS_BAD = new Set(["refunded_xaf", "disputes_opened", "reports_filed"]);
const HEADLINE_ORDER = [
  "new_users",
  "paid_bookings",
  "payment_volume_xaf",
  "fees_earned_xaf",
  "kyc_submitted",
  "kyc_verified",
  "property_listings_published",
  "marketplace_listings_created",
  "payouts_xaf",
  "refunded_xaf",
  "disputes_opened",
  "reports_filed",
  "support_chats",
] as const;

function MetricCard({ name, metric }: { name: string; metric: AdminAnalyticsMetric }) {
  const t = useTranslations("AdminConsolePage");
  const money = MONEY.has(name);
  const value = Number(metric.current);
  const change = metric.change;
  const good = change === null || change === 0 ? null : RISE_IS_BAD.has(name) ? change < 0 : change > 0;
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t(`analyticsMetric_${name}`)}</p>
      <p className="mt-1 text-xl font-black text-slate-900">
        {value.toLocaleString()} {money && <span className="text-xs font-medium text-slate-400">XAF</span>}
      </p>
      <p className={`mt-0.5 text-[11px] font-bold ${good === null ? "text-slate-400" : good ? "text-emerald-600" : "text-rose-600"}`}>
        {change === null
          ? Number(metric.current) > 0
            ? t("analyticsNew")
            : t("analyticsNoChange")
          : `${change > 0 ? "▲" : change < 0 ? "▼" : "•"} ${Math.abs(change)}% ${t("analyticsVsPrevious")}`}
      </p>
    </div>
  );
}

type SeriesPoint = AdminAnalytics["series"]["points"][number];

function BarSeries({ title, points, pick, money }: { title: string; points: SeriesPoint[]; pick: (p: SeriesPoint) => number; money?: boolean }) {
  const values = points.map(pick);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <span className="text-xs font-bold text-slate-500">
          {total.toLocaleString()}
          {money ? " XAF" : ""}
        </span>
      </div>
      <div className="flex h-32 items-end gap-px" role="img" aria-label={title}>
        {points.map((p, i) => (
          <div key={p.date} className="flex h-full flex-1 flex-col justify-end" title={`${p.date}: ${values[i].toLocaleString()}${money ? " XAF" : ""}`}>
            <div className="w-full rounded-t bg-amber-400" style={{ height: `${values[i] ? Math.max(3, (values[i] / max) * 100) : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </section>
  );
}

/** How the platform is moving over a chosen period: headline figures, trends, conversion, response times, breakdowns. */
export default function AdminAnalyticsPanel({ token }: { token: string }) {
  const t = useTranslations("AdminConsolePage");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getAdminAnalytics(days, token));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [days, token]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const pill = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`;
  const hours = (value: number | null) =>
    value === null ? "—" : value >= 48 ? t("analyticsDays", { n: Math.round((value / 24) * 10) / 10 }) : t("analyticsHours", { n: value });

  return (
    <div className="space-y-5 animate-rise-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-slate-500">{t("analyticsIntro")}</p>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((value) => (
            <button key={value} onClick={() => setDays(value)} className={pill(days === value)}>
              {t("paymentsDays", { days: value })}
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-rose-700">{t("analyticsLoadError")}</p>
        </div>
      ) : !data ? (
        <p className="text-xs font-semibold text-slate-500">{t("usersLoading")}</p>
      ) : (
        <div className={`space-y-5 ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {HEADLINE_ORDER.map((name) => (
              <MetricCard key={name} name={name} metric={data.headline[name]} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <BarSeries
              title={t(data.series.interval === "week" ? "analyticsSignupsWeekly" : "analyticsSignupsDaily")}
              points={data.series.points}
              pick={(p) => p.new_users}
            />
            <BarSeries
              title={t(data.series.interval === "week" ? "analyticsBookingsWeekly" : "analyticsBookingsDaily")}
              points={data.series.points}
              pick={(p) => p.paid_bookings}
            />
            <BarSeries
              title={t(data.series.interval === "week" ? "analyticsVolumeWeekly" : "analyticsVolumeDaily")}
              points={data.series.points}
              pick={(p) => Number(p.payment_volume_xaf)}
              money
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">{t("analyticsFunnelTitle")}</h3>
              <p className="mb-3 text-[11px] text-slate-500">{t("analyticsFunnelHint")}</p>
              <ul className="space-y-2.5">
                {data.funnel.map((step) => (
                  <li key={step.step}>
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="font-semibold text-slate-700">{t(`analyticsFunnel_${step.step}`)}</span>
                      <span className="font-bold text-slate-900">
                        {step.count.toLocaleString()}
                        {step.percent !== null && step.step !== "joined" && <span className="ml-1 font-medium text-slate-400">({step.percent}%)</span>}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-slate-900" style={{ width: `${step.percent ?? 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">{t("analyticsSpeedTitle")}</h3>
              <p className="mb-3 text-[11px] text-slate-500">{t("analyticsSpeedHint")}</p>
              <ul className="divide-y divide-slate-100">
                {(["kyc_review", "dispute_resolution", "withdrawal_review"] as const).map((key) => (
                  <li key={key} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                    <span className="font-semibold text-slate-700">{t(`analyticsSpeed_${key}`)}</span>
                    <span className="text-right">
                      <span className="font-black text-slate-900">{hours(data.speed[key].median_hours)}</span>
                      <span className="ml-2 text-[11px] text-slate-400">{t("analyticsSpeedCount", { count: data.speed[key].count })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-slate-900">{t("analyticsByService")}</h3>
              {data.breakdowns.by_service.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">{t("paymentsNoneInPeriod")}</p>
              ) : (
                <ul className="space-y-2">
                  {data.breakdowns.by_service.map((row) => {
                    const max = Math.max(1, ...data.breakdowns.by_service.map((r) => Number(r.volume_xaf)));
                    return (
                      <li key={row.booking_type}>
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate font-semibold text-slate-700">
                            {t.has(`paymentType_${row.booking_type}`) ? t(`paymentType_${row.booking_type}`) : row.label}
                          </span>
                          <span className="shrink-0 font-bold text-slate-900">{Number(row.volume_xaf).toLocaleString()} XAF</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.max(3, (Number(row.volume_xaf) / max) * 100)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-slate-900">{t("analyticsTopNeighbourhoods")}</h3>
              {data.breakdowns.top_neighbourhoods.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">{t("analyticsNoListings")}</p>
              ) : (
                <ol className="space-y-1.5 text-xs">
                  {data.breakdowns.top_neighbourhoods.map((row, i) => (
                    <li key={row.name} className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-slate-700">
                        <span className="mr-2 text-slate-400">{i + 1}.</span>
                        {row.name}
                      </span>
                      <span className="font-bold text-slate-900">{row.count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-bold text-slate-900">{t("analyticsNewProviders")}</h3>
              <ul className="space-y-1.5 text-xs">
                {(["agents", "agencies", "landlords", "technicians", "drivers"] as const).map((role) => (
                  <li key={role} className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-slate-700">{t(`analyticsRole_${role}`)}</span>
                    <span className="font-bold text-slate-900">{data.breakdowns.new_providers[role]}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

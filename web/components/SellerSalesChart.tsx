"use client";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { SellerDashboard } from "@/lib/api";
import { chartBars } from "@/lib/marketplaceOrderFlow";

/** Net earnings per day or month as plain bars; hovering a bar shows its date, orders and gross sales. */
export default function SellerSalesChart({ series }: { series: SellerDashboard["series"] }) {
  const t = useTranslations("SellerDashboard");
  const format = useFormatter();
  const locale = useLocale();
  const money = (value: string | number) => `${new Intl.NumberFormat(locale).format(Number(value))} XAF`;
  const label = (date: string) => series.bucket === "month"
    ? format.dateTime(new Date(`${date}-01T12:00:00`), { month: "short", year: "numeric" })
    : format.dateTime(new Date(`${date}T12:00:00`), { dateStyle: "medium" });
  const heights = chartBars(series.points);
  const total = series.points.reduce((sum, point) => sum + point.orders, 0);

  if (series.points.length === 0 || total === 0) return <p className="py-10 text-center text-sm text-slate-500">{t("chartEmpty")}</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="flex h-48 items-end gap-1 border-b border-slate-200" style={{ minWidth: `${series.points.length * 0.9}rem` }} role="img" aria-label={t("chartLabel")}>
          {series.points.map((point, index) => (
            <div
              key={point.date} className="group flex h-full min-w-[0.5rem] flex-1 items-end"
              title={t("barTitle", { date: label(point.date), orders: point.orders, gross: money(point.gross_xaf), net: money(point.net_xaf) })}
            >
              <div className="w-full rounded-t bg-[var(--navy)]/80 transition-colors group-hover:bg-[var(--gold)]" style={{ height: `${heights[index]}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{label(series.points[0].date)}</span>
        <span>{label(series.points[series.points.length - 1].date)}</span>
      </div>
    </div>
  );
}

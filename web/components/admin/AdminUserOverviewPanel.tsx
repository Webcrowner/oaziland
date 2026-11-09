"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getAdminUserOverview, type AdminUserOverview } from "@/lib/api";

interface Props {
  userId: string;
  token: string;
  onClose: () => void;
}

function Stat({ label, value, tone = "text-slate-900" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className={`mt-0.5 text-base font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}

/** Everything about one account on a single card: identity check, money, activity, reports and strikes. */
export default function AdminUserOverviewPanel({ userId, token, onClose }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [data, setData] = useState<AdminUserOverview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAdminUserOverview(userId, token)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [userId, token]);

  const money = (value: string) => `${Number(value).toLocaleString()} XAF`;
  const kycTone: Record<string, string> = {
    VERIFIED: "bg-emerald-100 text-emerald-800",
    PENDING: "bg-amber-100 text-amber-800",
    REJECTED: "bg-rose-100 text-rose-800",
  };

  return (
    <div className="mt-3 w-full rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-slate-900">{t("overviewTitle")}</h4>
        <button onClick={onClose} className="rounded-lg px-2.5 py-1 text-xs font-bold text-slate-500 hover:bg-white hover:text-slate-900">
          {t("kycClose")}
        </button>
      </div>

      {failed ? (
        <p className="py-4 text-center text-xs font-semibold text-rose-700">{t("overviewLoadError")}</p>
      ) : !data ? (
        <p className="py-4 text-center text-xs text-slate-500">{t("usersLoading")}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${kycTone[data.kyc.status] ?? "bg-slate-100 text-slate-600"}`}>
              {t(`withdrawalKyc_${data.kyc.status}`)}
            </span>
            {data.kyc.legal_name && <span className="font-semibold text-slate-800">{data.kyc.legal_name}</span>}
            <span>{data.user.email || "—"}</span>
            <span>·</span>
            <span>{data.user.phone}</span>
            <span>·</span>
            <span>{data.language === "FR" ? "Français" : "English"}</span>
            <span>·</span>
            <span>{data.last_seen_at ? t("overviewLastSeen", { when: new Date(data.last_seen_at).toLocaleString() }) : t("overviewNeverSeen")}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("overviewBalance")} value={money(data.wallet.balance_xaf)} />
            <Stat label={t("overviewPaidOut")} value={money(data.wallet.paid_out_xaf)} />
            <Stat label={t("overviewPendingWithdrawals")} value={data.wallet.pending_withdrawals} tone={data.wallet.pending_withdrawals ? "text-amber-700" : undefined} />
            <Stat label={t("overviewStrikes")} value={data.user.strikes_count} tone={data.user.strikes_count ? "text-rose-700" : undefined} />
            <Stat label={t("overviewReportsAgainstOpen")} value={data.reports.against_open} tone={data.reports.against_open ? "text-rose-700" : undefined} />
            <Stat label={t("overviewReportsAgainstTotal")} value={data.reports.against_total} />
            <Stat label={t("overviewReportsFiled")} value={data.reports.filed} />
            <Stat label={t("overviewSupportChats")} value={data.activity.support_chats} />
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">{t("overviewActivity")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label={t("overviewPropertyListings")} value={data.activity.property_listings} />
              <Stat label={t("overviewMarketListings")} value={data.activity.marketplace_listings} />
              <Stat label={t("overviewPurchases")} value={data.activity.marketplace_purchases} />
              <Stat label={t("overviewSales")} value={data.activity.marketplace_sales} />
              <Stat label={t("overviewBookings")} value={data.activity.bookings} />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">{t("overviewPosts", { count: data.activity.posts })}</p>
          </div>

          {data.strikes.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">{t("overviewStrikeHistory")}</p>
              <ul className="space-y-1">
                {data.strikes.map((s) => (
                  <li key={s.number} className="flex flex-wrap items-center gap-x-3 rounded-lg bg-white px-3 py-1.5 text-xs text-slate-700">
                    <span className="font-bold text-rose-700">#{s.number}</span>
                    <span className="font-semibold">{s.reason.replaceAll("_", " ")}</span>
                    <span className="text-slate-400">{new Date(s.issued_at).toLocaleDateString()}</span>
                    {s.issued_by && <span className="text-slate-400">{t("overviewIssuedBy", { name: s.issued_by })}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

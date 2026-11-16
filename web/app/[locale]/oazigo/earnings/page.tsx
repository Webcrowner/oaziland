"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import WalletPayoutCard from "@/components/WalletPayoutCard";
import { IconCreditCard, IconArrowUpRight } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import DriverEarnings from "@/components/oazigo/DriverEarnings";
import { cardCls } from "@/components/oazigo/styles";

export default function OaziGoEarningsPage() {
  const t = useTranslations("OaziGoPage");
  const { status, rides, driverProfile, myUserId } = useOaziGo();

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="h-28 rounded-3xl bg-white/70 animate-pulse" />
          <div className="h-28 rounded-3xl bg-white/70 animate-pulse" />
        </div>
        <div className="h-56 rounded-3xl bg-white/70 animate-pulse" />
      </div>
    );
  }

  if (!driverProfile?.is_verified) {
    return (
      <EmptyState
        icon={<IconCreditCard size={28} />}
        title={t("earningsDriversOnly")}
        action={<Button variant="dark" href="/oazigo/drive">{t("navDrive")}</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className={`${cardCls} flex flex-wrap items-start justify-between gap-4`}>
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight text-slate-900">{t("earningsTitle")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("earningsSubtitle")}</p>
        </div>
        <Link
          href="/driver-dashboard"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          {t("openDriverDashboard")} <IconArrowUpRight size={14} />
        </Link>
      </div>
      <DriverEarnings rides={rides} driverId={myUserId} />
      <WalletPayoutCard title={t("walletTitle")} subtitle={t("walletSubtitle")} />
    </div>
  );
}

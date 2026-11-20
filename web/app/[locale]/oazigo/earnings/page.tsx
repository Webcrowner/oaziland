"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import WalletPayoutCard from "@/components/WalletPayoutCard";
import { IconCreditCard, IconArrowUpRight } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import DriverEarnings from "@/components/oazigo/DriverEarnings";

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
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-lg shadow-slate-900/10 sm:px-8 sm:py-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20">
              <IconCreditCard size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("earningsTitle")}</h1>
              <p className="mt-1 text-sm text-slate-300">{t("earningsSubtitle")}</p>
            </div>
          </div>
          <Link
            href="/driver-dashboard"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition-colors"
          >
            {t("openDriverDashboard")} <IconArrowUpRight size={14} />
          </Link>
        </div>
      </section>
      <DriverEarnings rides={rides} driverId={myUserId} />
      <WalletPayoutCard title={t("walletTitle")} subtitle={t("walletSubtitle")} />
    </div>
  );
}

"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import EmptyState from "@/components/ui/EmptyState";
import { IconAlertCircle, IconCar, IconClock, IconRefresh } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import TripCard from "@/components/oazigo/TripCard";
import { ACTIVE_RIDE_STATUSES, cardCls } from "@/components/oazigo/styles";

type Filter = "all" | "active" | "completed";

export default function OaziGoTripsPage() {
  const t = useTranslations("OaziGoPage");
  const { status, myRides: rides, loadFailed, reload } = useOaziGo();
  const [filter, setFilter] = useState<Filter>("active");

  const visible = rides.filter((r) =>
    filter === "all" ? true : filter === "active" ? ACTIVE_RIDE_STATUSES.includes(r.status) : !ACTIVE_RIDE_STATUSES.includes(r.status),
  );

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-lg shadow-slate-900/10 sm:px-8 sm:py-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20">
              <IconClock size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("myTripsTitle")}</h1>
              <p className="mt-1 text-sm text-slate-300">
                {status === "loading" ? t("loadingTrips") : loadFailed ? t("requestCardDesc") : t("tripsCardDesc", { count: rides.filter((r) => ACTIVE_RIDE_STATUSES.includes(r.status)).length })}
              </p>
            </div>
          </div>
          <Link href="/oazigo/request" className="inline-flex min-h-11 items-center rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-sm hover:bg-amber-300 transition-colors">
            {t("requestRideTitle")}
          </Link>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1.5 rounded-2xl border border-slate-200/90 bg-white p-1.5 shadow-sm">
          {(["active", "completed", "all"] as const).map((f) => (
            <button
              key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${filter === f ? "bg-slate-900 text-amber-300 shadow-sm" : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"}`}
            >
              {t(`filter_${f}`)}
            </button>
          ))}
        </div>
      </div>

      {status === "loading" ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("loadingTrips")}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${cardCls} animate-pulse border-slate-200/90`}>
              <div className="flex items-center justify-between gap-3">
                <div className="h-3 w-24 rounded bg-slate-200/70" />
                <div className="h-5 w-20 rounded-full bg-slate-200/70" />
              </div>
              <div className="mt-3 h-4 w-2/3 rounded bg-slate-200/70" />
              <div className="mt-2 h-3 w-1/3 rounded bg-slate-200/70" />
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-red-200 bg-red-50/90 px-6 py-5 text-sm text-red-900 shadow-sm">
          <div className="flex items-start gap-3">
            <IconAlertCircle size={20} className="mt-0.5 shrink-0 text-red-600" />
            <span className="font-semibold">{t("tripsLoadFailed")}</span>
          </div>
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition-colors cursor-pointer"
          >
            <IconRefresh size={14} />
            {t("retry")}
          </button>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconCar size={28} />}
          title={rides.length === 0 ? t("noRidesYet") : t("noTripsInFilter")}
          action={rides.length === 0 ? <Link href="/oazigo/request" className="inline-flex min-h-11 items-center rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-300 transition-colors">{t("requestRideTitle")}</Link> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((ride) => <TripCard key={ride.id} ride={ride} />)}
        </div>
      )}
    </div>
  );
}

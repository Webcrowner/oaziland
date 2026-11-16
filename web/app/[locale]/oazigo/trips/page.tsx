"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import EmptyState from "@/components/ui/EmptyState";
import { IconCar } from "@/components/Icons";
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
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-black tracking-tight text-slate-900">{t("myTripsTitle")}</h1>
        <Link href="/oazigo/request" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-slate-800 transition-colors">
          {t("requestRideTitle")}
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        {(["active", "completed", "all"] as const).map((f) => (
          <button
            key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`rounded-xl px-3.5 py-2 text-xs font-bold border transition-colors cursor-pointer ${filter === f ? "bg-slate-900 text-amber-300 border-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {t(`filter_${f}`)}
          </button>
        ))}
      </div>

      {status === "loading" ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("loadingTrips")}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${cardCls} animate-pulse`}>
              <div className="flex items-center justify-between gap-3">
                <div className="h-3 w-24 rounded bg-slate-100" />
                <div className="h-5 w-20 rounded-full bg-slate-100" />
              </div>
              <div className="mt-3 h-4 w-2/3 rounded bg-slate-100" />
              <div className="mt-2 h-3 w-1/3 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          <span>{t("tripsLoadFailed")}</span>
          <button type="button" onClick={reload} className="font-bold underline cursor-pointer">{t("retry")}</button>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<IconCar size={28} />} title={rides.length === 0 ? t("noRidesYet") : t("noTripsInFilter")} />
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((ride) => <TripCard key={ride.id} ride={ride} />)}
        </div>
      )}
    </div>
  );
}

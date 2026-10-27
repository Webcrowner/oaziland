"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import EmptyState from "@/components/ui/EmptyState";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import TripCard from "@/components/oazigo/TripCard";
import { ACTIVE_RIDE_STATUSES, cardCls } from "@/components/oazigo/styles";

type Filter = "all" | "active" | "completed";

export default function OaziGoTripsPage() {
  const t = useTranslations("OaziGoPage");
  const { status, myRides: rides } = useOaziGo();
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
        <div className={`${cardCls} flex items-center gap-3 text-sm text-slate-500`}>
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
          {t("loadingTrips")}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon="🚕" title={rides.length === 0 ? t("noRidesYet") : t("noTripsInFilter")} />
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((ride) => <TripCard key={ride.id} ride={ride} />)}
        </div>
      )}
    </div>
  );
}

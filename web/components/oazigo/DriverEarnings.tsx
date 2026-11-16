"use client";
import { useLocale, useTranslations } from "next-intl";
import type { RideBookingItem } from "@/lib/api";
import Badge from "@/components/ui/Badge";
import { IconMapPin, IconChevronRight } from "@/components/Icons";
import { ACTIVE_RIDE_STATUSES, cardCls } from "./styles";
import { RideStatusBadge } from "./RideStatus";

const RECENT_LIMIT = 8;

function mapsLink(lat: RideBookingItem["pickup_latitude"], lng: RideBookingItem["pickup_longitude"]) {
  return lat && lng ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null;
}

/**
 * Earnings and driving history, shared by the OaziGo Earnings tab and the
 * driver dashboard. Only counts rides the user drove: /api/rides/ also
 * returns rides they booked as a rider, which are not earnings.
 */
export default function DriverEarnings({ rides, driverId }: { rides: RideBookingItem[]; driverId: string | null }) {
  const t = useTranslations("OaziGoPage");
  const locale = useLocale();

  const driven = driverId ? rides.filter((r) => r.driver === driverId) : [];
  const completed = driven.filter((r) => r.status === "COMPLETED");
  const active = driven.filter((r) => ACTIVE_RIDE_STATUSES.includes(r.status));
  const gross = completed.reduce((sum, r) => sum + Number(r.fare_estimate_xaf || 0), 0);
  const recent = [...driven]
    .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime())
    .slice(0, RECENT_LIMIT);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={cardCls}>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("earningsCompletedTrips")}</p>
          <p className="mt-1 text-3xl font-black tracking-tight text-emerald-600">{completed.length}</p>
          <p className="mt-1 text-xs text-slate-400">{t("earningsActiveTrips", { count: active.length })}</p>
        </div>
        <div className={cardCls}>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("earningsGrossFares")}</p>
          <p className="mt-1 text-3xl font-black tracking-tight text-slate-900">
            {gross.toLocaleString(locale)} <span className="text-sm font-bold text-slate-400">XAF</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">{t("earningsGrossHint")}</p>
        </div>
      </div>

      <section className={cardCls}>
        <h2 className="mb-3 text-base font-black tracking-tight text-slate-900">{t("earningsRecentTrips")}</h2>
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{t("earningsNoTrips")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {recent.map((ride) => {
              const toPickup = ACTIVE_RIDE_STATUSES.includes(ride.status) ? mapsLink(ride.pickup_latitude, ride.pickup_longitude) : null;
              const toDropoff = ACTIVE_RIDE_STATUSES.includes(ride.status) ? mapsLink(ride.dropoff_latitude, ride.dropoff_longitude) : null;
              return (
                <li key={ride.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="neutral">{t(`category_${ride.ride_category}`)}</Badge>
                      <RideStatusBadge status={ride.status} />
                      <time dateTime={ride.requested_at} className="text-xs text-slate-400">
                        {new Date(ride.requested_at).toLocaleDateString(locale, { dateStyle: "medium" })}
                      </time>
                    </div>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-800">
                      <IconMapPin size={14} className="shrink-0 text-amber-500" />
                      <span>{ride.pickup_description}</span>
                      <IconChevronRight size={13} className="shrink-0 text-slate-400" />
                      <span>{ride.dropoff_description}</span>
                    </p>
                    {(toPickup || toDropoff) && (
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {toPickup && (
                          <a href={toPickup} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-amber-400 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-300">
                            {t("followToPickup")} ↗
                          </a>
                        )}
                        {toDropoff && (
                          <a href={toDropoff} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white hover:bg-slate-800">
                            {t("followToDropoff")} ↗
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <p className="text-sm font-black text-slate-900">{Number(ride.fare_estimate_xaf).toLocaleString(locale)} XAF</p>
                    {ride.distance_km && <p className="text-xs text-slate-400">{Number(ride.distance_km)} km</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

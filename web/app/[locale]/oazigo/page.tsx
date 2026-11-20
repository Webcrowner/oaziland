"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { IconCar, IconMapPin, IconChevronRight, IconClock, IconCompass, IconShieldCheck, IconShoppingBag } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import OaziGoHero from "@/components/oazigo/OaziGoHero";
import HowItWorks from "@/components/oazigo/HowItWorks";
import RouteStops from "@/components/oazigo/RouteStops";
import { RideStatusBadge, TripProgress } from "@/components/oazigo/RideStatus";
import { ACTIVE_RIDE_STATUSES, cardCls } from "@/components/oazigo/styles";

/**
 * OaziGo hub — Oaziland's own-branded ride and transport service.
 * Each function (requesting, trips, driving, safety) lives on its own
 * page; this page only orients the user and surfaces what needs attention.
 */
export default function OaziGoPage() {
  const t = useTranslations("OaziGoPage");
  const { status, myRides: rides, driverProfile, vehicles, myUserId } = useOaziGo();

  const activeRides = rides.filter((r) => ACTIVE_RIDE_STATUSES.includes(r.status));
  const latest = activeRides[0];

  const driveState = status === "loading"
    ? t("loading")
    : !driverProfile
    ? t("driveCardNotRegistered")
    : !driverProfile.is_verified
      ? t("driverPendingVerification")
      : t("driveCardVerified", { count: vehicles.length });

  const cards = [
    { href: "/oazigo/request", icon: IconMapPin, title: t("navRequest"), desc: t("requestCardDesc") },
    {
      href: "/oazigo/trips", icon: IconClock, title: t("navTrips"),
      desc: status === "loading" ? t("loading") : t("tripsCardDesc", { count: activeRides.length }),
    },
    { href: "/oazigo/drive", icon: IconCar, title: t("navDrive"), desc: driveState },
    ...(driverProfile?.is_verified
      ? [{ href: "/oazigo/requests", icon: IconCompass, title: t("navRequests"), desc: driverProfile.is_online ? t("onlineHint") : t("offlineHint") }]
      : []),
    { href: "/oazigo/safety", icon: IconShieldCheck, title: t("navSafety"), desc: t("safetyCardDesc") },
    { href: "/oazigo/cars", icon: IconShoppingBag, title: t("navCars"), desc: t("carsCardDesc") },
  ];

  return (
    <div className="flex flex-col gap-8">
      <OaziGoHero />

      {latest && (
        <Link href="/oazigo/trips" className={`${cardCls} block overflow-hidden transition-shadow hover:shadow-md`}>
          <div
            className={`-mx-5 -mt-5 mb-4 flex items-center gap-3 px-5 py-3.5 sm:-mx-6 sm:-mt-6 sm:px-6 ${
              latest.status === "REQUESTED" ? "bg-amber-50 text-amber-950" : "bg-slate-900 text-white"
            }`}
          >
            <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${latest.status === "REQUESTED" ? "bg-amber-500" : "bg-emerald-400"}`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${latest.status === "REQUESTED" ? "bg-amber-500" : "bg-emerald-400"}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{t("currentTrip")}</p>
              <p className="text-sm font-black tracking-tight">
                {t(
                  latest.status === "REQUESTED" ? "liveHeadline_REQUESTED"
                    : latest.status === "ACCEPTED" ? (latest.rider === myUserId ? "liveHeadline_ACCEPTED_rider" : "liveHeadline_ACCEPTED_driver")
                      : latest.rider === myUserId ? "liveHeadline_IN_PROGRESS_rider" : "liveHeadline_IN_PROGRESS_driver",
                )}
              </p>
            </div>
            <IconChevronRight size={16} className="shrink-0 opacity-60" />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <RouteStops pickup={latest.pickup_description} dropoff={latest.dropoff_description} pickupLabel={t("pickupLabel")} dropoffLabel={t("dropoffLabel")} />
              {latest.driver && latest.driver_name && (
                <p className="mt-3 text-xs text-slate-500">
                  {latest.rider === myUserId ? t("yourDriver", { name: latest.driver_name }) : t("yourRider", { name: latest.rider_name })}
                  {latest.vehicle_details && ` · ${latest.vehicle_details.make} ${latest.vehicle_details.model} · ${latest.vehicle_details.plate_number}`}
                </p>
              )}
            </div>
            <RideStatusBadge status={latest.status} />
          </div>
          <TripProgress status={latest.status} />
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c, idx) => (
          <Link
            key={c.href}
            href={c.href}
            className={`group flex items-start gap-4 rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 sm:p-6 ${
              idx === 0
                ? "border-amber-300/80 bg-gradient-to-br from-amber-50/90 via-white to-white hover:border-amber-400"
                : "border-slate-200/90 bg-white hover:border-amber-300"
            }`}
          >
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-colors ${
              idx === 0
                ? "bg-amber-400 text-slate-950 shadow-sm shadow-amber-400/30"
                : "bg-slate-100 text-slate-800 group-hover:bg-amber-100 group-hover:text-amber-900"
            }`}>
              <c.icon size={21} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-black tracking-tight text-slate-900">{c.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-slate-600">{c.desc}</span>
            </span>
            <IconChevronRight size={16} className="mt-1 shrink-0 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-slate-700" />
          </Link>
        ))}
      </div>

      <HowItWorks />
    </div>
  );
}

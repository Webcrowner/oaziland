"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Badge from "@/components/ui/Badge";
import { IconCar, IconMapPin, IconChevronRight } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import HowItWorks from "@/components/oazigo/HowItWorks";
import { ACTIVE_RIDE_STATUSES, RIDE_CATEGORIES, STATUS_VARIANT, cardCls } from "@/components/oazigo/styles";

/**
 * OaziGo hub — Oaziland's own-branded ride and transport service.
 * Each function (requesting, trips, driving, safety) lives on its own
 * page; this page only orients the user and surfaces what needs attention.
 */
export default function OaziGoPage() {
  const t = useTranslations("OaziGoPage");
  const { status, myRides: rides, driverProfile, vehicles } = useOaziGo();

  const activeRides = rides.filter((r) => ACTIVE_RIDE_STATUSES.includes(r.status));
  const latest = activeRides[0];

  const driveState = status === "loading"
    ? t("loadingTrips")
    : !driverProfile
    ? t("driveCardNotRegistered")
    : !driverProfile.is_verified
      ? t("driverPendingVerification")
      : t("driveCardVerified", { count: vehicles.length });

  const cards = [
    { href: "/oazigo/request", icon: "🚕", title: t("navRequest"), desc: t("requestCardDesc") },
    {
      href: "/oazigo/trips", icon: "🧾", title: t("navTrips"),
      desc: status === "loading" ? t("loadingTrips") : t("tripsCardDesc", { count: activeRides.length }),
    },
    { href: "/oazigo/drive", icon: "🚗", title: t("navDrive"), desc: driveState },
    ...(driverProfile?.is_verified
      ? [{ href: "/oazigo/requests", icon: "📡", title: t("navRequests"), desc: driverProfile.is_online ? t("onlineHint") : t("offlineHint") }]
      : []),
    { href: "/oazigo/safety", icon: "🆘", title: t("navSafety"), desc: t("safetyCardDesc") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
              <IconCar size={28} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("title")}</h1>
              <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {RIDE_CATEGORIES.map((cat) => (
              <span key={cat} className="rounded-lg bg-white/10 border border-white/15 px-2.5 py-1 text-xs font-bold text-slate-200">
                {t(`category_${cat}`)}
              </span>
            ))}
          </div>
        </div>
      </section>

      {latest && (
        <Link href="/oazigo/trips" className={`${cardCls} block transition-shadow hover:shadow-md`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{t("currentTrip")}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-900">
                <IconMapPin size={15} className="shrink-0 text-amber-500" />
                <span>{latest.pickup_description}</span>
                <IconChevronRight size={14} className="shrink-0 text-slate-400" />
                <span>{latest.dropoff_description}</span>
              </p>
            </div>
            <Badge variant={STATUS_VARIANT[latest.status] || "neutral"}>{latest.status.replace("_", " ")}</Badge>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className={`${cardCls} group flex items-start gap-4 transition-shadow hover:shadow-md`}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-xl">{c.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-black tracking-tight text-slate-900">{c.title}</span>
              <span className="mt-0.5 block text-sm text-slate-500">{c.desc}</span>
            </span>
            <IconChevronRight size={16} className="mt-1 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>

      <HowItWorks />
    </div>
  );
}

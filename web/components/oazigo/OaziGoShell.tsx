"use client";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import Button from "@/components/ui/Button";
import { NavCarIcon, NavGpsIcon, NavMarketIcon } from "@/components/navIcons";
import { IconCar, IconClock, IconCompass, IconCreditCard, IconMapPin, IconShieldCheck } from "@/components/Icons";
import { OaziGoProvider, useOaziGo } from "./OaziGoProvider";
import OaziGoHero from "./OaziGoHero";
import DriverLocationSharer from "./DriverLocationSharer";
import RideOfferBanner from "./RideOfferBanner";
import { cardCls } from "./styles";

const TABS = [
  { href: "/oazigo", key: "navOverview", icon: IconCompass },
  { href: "/oazigo/request", key: "navRequest", icon: NavGpsIcon },
  { href: "/oazigo/trips", key: "navTrips", icon: IconClock },
  { href: "/oazigo/requests", key: "navRequests", icon: IconCompass, driversOnly: true },
  { href: "/oazigo/earnings", key: "navEarnings", icon: IconCreditCard, driversOnly: true },
  { href: "/oazigo/drive", key: "navDrive", icon: NavCarIcon },
  { href: "/oazigo/safety", key: "navSafety", icon: IconShieldCheck },
  // Not part of ride-hailing: the Marketplace's car listings, kept last so the ride tabs read first.
  { href: "/oazigo/cars", key: "navCars", icon: NavMarketIcon },
] as const;

// Pages anyone can browse without signing in.
const PUBLIC_PATHS = ["/oazigo/cars"];

function Frame({ children }: { children: React.ReactNode }) {
  const t = useTranslations("OaziGoPage");
  const common = useTranslations("MobileNav");
  const pathname = usePathname();
  const { status, driverProfile, stale, driverDataFailed, loadFailed, reload } = useOaziGo();
  const isVerifiedDriver = Boolean(driverProfile?.is_verified);
  // A failed trips load has its own retry on the pages that list trips.
  const notice = status === "ready" && !loadFailed ? (stale ? "staleDataBanner" : driverDataFailed ? "driverDataFailedBanner" : null) : null;

  if (status === "signedOut" && !PUBLIC_PATHS.includes(pathname)) {
    if (pathname === "/oazigo") {
      const features = [
        { icon: IconMapPin, title: t("navRequest"), desc: t("requestCardDesc") },
        { icon: IconCar, title: t("navDrive"), desc: t("driveCardNotRegistered") },
        { icon: IconShieldCheck, title: t("navSafety"), desc: t("safetyCardDesc") },
      ];
      return (
        <div className="min-h-[70vh] bg-gradient-to-b from-slate-100 via-slate-50 to-white">
          <main className="mx-auto max-w-5xl px-4 pt-6 pb-24 sm:px-6 sm:py-10">
            <OaziGoHero signedOut />
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {features.map((feature) => (
                <div key={feature.title} className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><feature.icon size={20} /></span>
                  <h2 className="mt-4 text-base font-black text-slate-900">{feature.title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{feature.desc}</p>
                </div>
              ))}
            </div>
          </main>
        </div>
      );
    }
    return (
      <main className="max-w-md mx-auto px-4 py-16">
        <div className={`${cardCls} text-center`}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
            <IconCar size={26} />
          </div>
          <p className="text-slate-600 mb-4 font-semibold text-sm">{t("signInRequired")}</p>
          <Button variant="dark" href="/login">{common("signIn")}</Button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-[70vh] bg-gradient-to-b from-slate-100 via-slate-50 to-white">
    <main className={`${pathname === "/oazigo/cars" ? "max-w-6xl" : "max-w-5xl"} mx-auto px-4 pt-6 pb-24 sm:px-6 sm:py-8`}>
      <nav aria-label="OaziGo" className="mb-6 -mx-4 sm:mx-0 overflow-x-auto px-4 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="flex w-max gap-1.5 rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur md:w-auto md:flex-wrap">
          {TABS.filter((tab) => !("driversOnly" in tab) || isVerifiedDriver).map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${active ? "bg-slate-900 text-amber-300 shadow-sm" : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"}`}
                >
                  <Icon size={14} className={active ? "text-amber-300" : "text-slate-400"} />
                  {t(tab.key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {notice && (
        <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
          <span>{t(notice)}</span>
          <button type="button" onClick={reload} className="rounded-lg bg-amber-900 px-3 py-1.5 font-bold text-white hover:bg-amber-800 transition-colors cursor-pointer">
            {t("retry")}
          </button>
        </div>
      )}
      {children}
      <DriverLocationSharer />
      <RideOfferBanner />
    </main>
    </div>
  );
}

export default function OaziGoShell({ children }: { children: React.ReactNode }) {
  return (
    <OaziGoProvider>
      <Frame>{children}</Frame>
    </OaziGoProvider>
  );
}

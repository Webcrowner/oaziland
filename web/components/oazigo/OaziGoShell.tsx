"use client";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import Button from "@/components/ui/Button";
import { IconCar } from "@/components/Icons";
import { OaziGoProvider, useOaziGo } from "./OaziGoProvider";
import DriverLocationSharer from "./DriverLocationSharer";
import { cardCls } from "./styles";

const TABS = [
  { href: "/oazigo", key: "navOverview" },
  { href: "/oazigo/request", key: "navRequest" },
  { href: "/oazigo/trips", key: "navTrips" },
  { href: "/oazigo/requests", key: "navRequests", driversOnly: true },
  { href: "/oazigo/drive", key: "navDrive" },
  { href: "/oazigo/safety", key: "navSafety" },
] as const;

function Frame({ children }: { children: React.ReactNode }) {
  const t = useTranslations("OaziGoPage");
  const pathname = usePathname();
  const { status, driverProfile } = useOaziGo();
  const isVerifiedDriver = Boolean(driverProfile?.is_verified);

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16">
        <div className={`${cardCls} text-center`}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
            <IconCar size={26} />
          </div>
          <p className="text-slate-600 mb-4 font-semibold text-sm">{t("signInRequired")}</p>
          <Button variant="dark" href="/login">{t("signInRequired")}</Button>
        </div>
      </main>
    );
  }

  return (
    <div className="bg-slate-200 min-h-[70vh]">
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <nav aria-label="OaziGo" className="mb-6 -mx-4 sm:mx-0 overflow-x-auto px-4 sm:px-0">
        <ul className="flex gap-1.5 w-max sm:w-auto rounded-2xl border border-slate-300/80 bg-white p-1.5 shadow-sm">
          {TABS.filter((tab) => !("driversOnly" in tab) || isVerifiedDriver).map((tab) => {
            const active = pathname === tab.href;
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`block whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${active ? "bg-slate-900 text-amber-300" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  {t(tab.key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
      <DriverLocationSharer />
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

"use client";
import { ReactNode, useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, useRouter, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { getMyProfile, devSwitchRole, type UserProfile } from "@/lib/api";
import {
  IconSearch,
  IconHotel,
  IconGraduationCap,
  IconParty,
  IconHome,
  IconCompass,
  IconChevronRight,
  IconDashboard,
  IconX,
} from "@/components/Icons";

interface SidebarFrameProps {
  /** Role/account-specific content: identity card, nav groups, switchers. */
  sidebar: ReactNode;
  children: ReactNode;
}

// TEMPORARY dev role switcher (only rendered in `next dev`).
const DEV_ROLES = [
  { role: "renter", label: "Renter", href: "/renter-dashboard" },
  { role: "landlord", label: "Landlord", href: "/landlord-portfolio" },
  { role: "agent", label: "Agent", href: "/dashboard" },
  { role: "student", label: "Student", href: "/student-dashboard" },
  { role: "driver", label: "OaziGo Driver", href: "/driver-dashboard" },
  { role: "technician", label: "Technician", href: "/technician-dashboard" },
] as const;
const DEV_ROLE_KEY = "dev_active_role";
const SHOW_DEV_ROLES = process.env.NODE_ENV === "development";

function primaryDashboardHref(profile: UserProfile | null, devRole: string | null): string {
  const override = DEV_ROLES.find((r) => r.role === devRole);
  if (override) return override.href;
  if (profile?.is_agent) return "/dashboard";
  if (profile?.is_landlord) return "/landlord-portfolio";
  if (profile?.is_technician) return "/technician-dashboard";
  if (profile?.is_driver) return "/driver-dashboard";
  if (profile?.is_student) return "/student-dashboard";
  return "/renter-dashboard";
}

/**
 * Full-height left sidebar that replaces the global top bar on dashboard/account
 * pages: logo, role-specific nav, public-site links, language, account actions.
 */
export default function SidebarFrame({ sidebar, children }: SidebarFrameProps) {
  const t = useTranslations("Header");
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [devRole, setDevRole] = useState<string | null>(null);
  const [devRoleBusy, setDevRoleBusy] = useState(false);
  const [devRoleError, setDevRoleError] = useState("");

  useEffect(() => {
    const storedRole = localStorage.getItem(DEV_ROLE_KEY);
    void Promise.resolve().then(() => setDevRole(storedRole));
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyProfile(token)
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  function handleLogOut() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    setProfile(null);
    setMobileOpen(false);
    router.push("/");
  }

  async function handleDevRoleSwitch(role: string, href: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setDevRoleBusy(true);
    setDevRoleError("");
    try {
      setProfile(await devSwitchRole(role, token));
      localStorage.setItem(DEV_ROLE_KEY, role);
      setDevRole(role);
      setMobileOpen(false);
      router.push(href);
    } catch (err) {
      setDevRoleError(err instanceof Error ? err.message : "Role switch failed.");
    } finally {
      setDevRoleBusy(false);
    }
  }

  const dashboardHref = primaryDashboardHref(profile, SHOW_DEV_ROLES ? devRole : null);

  const exploreLinks = [
    { href: "/search", label: t("exploreProperties"), icon: IconSearch },
    { href: "/hotels", label: t("hotels"), icon: IconHotel },
    { href: "/student-hostels", label: t("studentHostels"), icon: IconGraduationCap },
    { href: "/events", label: t("events"), icon: IconParty },
    { href: "/guest-houses", label: t("guestHouses"), icon: IconHome },
    { href: "/wanted", label: t("wantedBoard"), icon: IconCompass },
  ];

  const actionClass =
    "flex items-center justify-center px-2 py-2.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors";

  const panel = (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="Oaziland home">
          <Image
            src="/logo.png"
            alt="Oaziland"
            width={116}
            height={116}
            style={{ width: "auto", height: "60px" }}
            priority
            className="object-contain drop-shadow"
          />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label={t("toggleMenu")}
          className="md:hidden p-2 rounded-lg text-slate-300 hover:text-white bg-white/5 border border-white/10"
        >
          <IconX size={18} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3 flex flex-col gap-4 text-slate-300 [scrollbar-width:thin]">
        <Link
          href={dashboardHref}
          className={`flex items-center gap-3.5 px-3 py-2.5 rounded-2xl text-sm font-extrabold border transition-colors ${
            pathname === dashboardHref
              ? "bg-amber-400 text-slate-950 border-amber-400"
              : "bg-slate-900 text-white border-slate-800 hover:bg-slate-800"
          }`}
        >
          <span className="w-12 h-12 rounded-xl bg-amber-400/15 text-amber-400 flex items-center justify-center shrink-0">
            <IconDashboard size={32} />
          </span>
          <span className="truncate">{t("dashboard")}</span>
        </Link>

        {sidebar}

        {SHOW_DEV_ROLES && (
          <div className="space-y-1.5 rounded-2xl border border-dashed border-amber-400/40 p-2.5">
            <p className="px-1 text-[10px] font-extrabold uppercase tracking-widest text-amber-300">
              Dev: Switch Role
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {DEV_ROLES.map((r) => (
                <button
                  key={r.role}
                  type="button"
                  disabled={devRoleBusy}
                  onClick={() => handleDevRoleSwitch(r.role, r.href)}
                  className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-50 ${
                    devRole === r.role
                      ? "bg-amber-400 text-slate-950 border-amber-400"
                      : "bg-slate-900 text-slate-300 border-slate-800 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {devRoleError && <p className="px-1 text-[10px] text-rose-300">{devRoleError}</p>}
          </div>
        )}

        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setExploreOpen((o) => !o)}
            aria-expanded={exploreOpen}
            className="w-full flex items-center justify-between px-3 py-1 text-xs font-extrabold uppercase tracking-widest text-slate-500 hover:text-slate-300"
          >
            <span>Explore Oaziland</span>
            <IconChevronRight size={12} className={`transition-transform ${exploreOpen ? "rotate-90" : ""}`} />
          </button>
          {exploreOpen &&
            exploreLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent transition-colors"
                >
                  <Icon size={32} className="text-slate-500 shrink-0" />
                  <span className="truncate">{link.label}</span>
                </Link>
              );
            })}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-800 p-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <LanguageSwitcher />
          {profile?.is_admin && (
            <Link
              href="/admin"
              className="whitespace-nowrap text-[11px] font-bold text-amber-300 hover:text-amber-200 px-2 py-1 rounded-lg bg-amber-400/10 border border-amber-400/20 hover:bg-amber-400/20 transition-colors"
            >
              {t("adminConsole")}
            </Link>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Link href="/messages" className={actionClass}>
            Messages
          </Link>
          <Link href="/account" className={actionClass}>
            {t("myAccount")}
          </Link>
          <button type="button" onClick={handleLogOut} className={actionClass}>
            {t("logOut")}
          </button>
        </div>
        <Link
          href="/list-property"
          className="whitespace-nowrap gold-gradient text-[var(--navy)] text-sm px-3 py-2.5 rounded-xl font-bold text-center transition-all duration-200 hover:shadow-lg hover:shadow-amber-500/20"
        >
          + {t("listAProperty")}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50/70">
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between bg-slate-950 border-b border-slate-800 px-4 py-2">
        <Link href="/" aria-label="Oaziland home">
          <Image
            src="/logo.png"
            alt="Oaziland"
            width={116}
            height={116}
            style={{ width: "auto", height: "40px" }}
            priority
            className="object-contain"
          />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={t("toggleMenu")}
          aria-expanded={mobileOpen}
          className="text-slate-200 hover:text-white p-2 rounded-lg bg-white/5 border border-white/10"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
          <div
            className="w-80 max-w-[85vw] h-full bg-slate-950 border-r border-slate-800 shadow-2xl"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
            }}
          >
            {panel}
          </div>
          <button
            type="button"
            aria-label={t("toggleMenu")}
            className="flex-1 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      <aside className="hidden md:block fixed inset-y-0 left-0 z-30 w-72 lg:w-80 bg-slate-950 border-r border-slate-800 shadow-2xl shadow-slate-950/40">
        {panel}
      </aside>

      <div className="md:pl-72 lg:pl-80">{children}</div>
    </div>
  );
}

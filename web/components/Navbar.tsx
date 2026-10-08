"use client";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import LanguageSwitcher from "./LanguageSwitcher";
import {
  IconBed, IconBriefcase, IconBuilding, IconCar, IconChevronRight, IconCompass, IconFileText, IconGraduationCap,
  IconHome, IconHotel, IconMessageCircle, IconParty, IconSearch, IconShoppingBag, IconSparkles, IconUsers, IconWrench,
} from "./Icons";
import { getMyProfile, listQuarters, type Quarter, type UserProfile } from "@/lib/api";

interface NavMenuItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

function dashboardHrefFor(profile: UserProfile | null): string {
  if (profile?.is_agent) return "/dashboard";
  if (profile?.is_landlord) return "/landlord-portfolio";
  if (profile?.is_technician) return "/technician-dashboard";
  if (profile?.is_driver) return "/driver-dashboard";
  if (profile?.is_student) return "/student-dashboard";
  return "/renter-dashboard";
}

/** Closes on outside click and Esc. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** Hover/click dropdown for a group of related links. */
function NavDropdown({ label, items, pathname }: { label: string; items: NavMenuItem[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const hrefPath = (href: string) => href.split("?")[0];
  const active = items.some((i) => pathname === hrefPath(i.href) || pathname.startsWith(`${hrefPath(i.href)}/`));

  return (
    <div ref={ref} className="relative shrink-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 whitespace-nowrap px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
          active || open ? "bg-white/15 text-[var(--gold)]" : "text-slate-200 hover:text-white hover:bg-white/10"
        }`}
      >
        {label}
        <IconChevronRight size={14} className={`transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full pt-2 z-50">
          <ul role="menu" className="w-64 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl shadow-black/50 p-1.5 flex flex-col gap-0.5">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href} role="none">
                  <Link
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-200 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <Icon size={20} className="text-slate-400" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Neighbourhood search: only real quarters can be chosen, so it always lands on a filtered results page. */
function HeaderSearch({ placeholder, label, className = "" }: { placeholder: string; label: string; className?: string }) {
  const router = useRouter();
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [value, setValue] = useState("");
  const loaded = useRef(false);
  const labelOf = (q: Quarter) => `${q.name} (${q.village_name})`;

  function load() {
    if (loaded.current) return;
    loaded.current = true;
    listQuarters().then(setQuarters).catch(() => { loaded.current = false; });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = value.trim().toLowerCase();
    const match =
      quarters.find((q) => labelOf(q).toLowerCase() === text) ?? quarters.find((q) => q.name.toLowerCase() === text);
    router.push(match ? `/search?quarter=${match.id}` : "/search");
  }

  return (
    <form onSubmit={submit} role="search" className={`relative ${className}`}>
      <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        list="header-quarters"
        value={value}
        onFocus={load}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full bg-white/10 border border-white/15 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:bg-white/15 focus:border-amber-400/60"
      />
      <datalist id="header-quarters">
        {quarters.map((q) => (
          <option key={q.id} value={labelOf(q)} />
        ))}
      </datalist>
    </form>
  );
}

function AvatarMenu({ profile, items, onLogOut, logOutLabel }: {
  profile: UserProfile | null;
  items: { href: string; label: string }[];
  onLogOut: () => void;
  logOutLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const name = profile?.full_name || profile?.username || "";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-10 h-10 rounded-full bg-amber-400 text-slate-950 font-extrabold text-sm flex items-center justify-center ring-2 ring-white/20 hover:ring-amber-300 transition-shadow"
      >
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 top-full pt-2 z-50">
          <div role="menu" className="w-60 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl shadow-black/50 p-1.5">
            {name && <p className="px-3 py-2 text-xs font-bold text-slate-400 truncate border-b border-slate-800 mb-1">{name}</p>}
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-200 hover:text-white hover:bg-slate-800 transition-colors"
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onLogOut(); }}
              className="w-full text-left px-3 py-2.5 mt-1 rounded-xl text-sm font-semibold text-rose-300 hover:bg-slate-800 border-t border-slate-800 transition-colors"
            >
              {logOutLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileGroup({ title, items, onNavigate }: { title: string; items: NavMenuItem[]; onNavigate: () => void }) {
  return (
    <div>
      <p className="px-1 mb-1.5 text-[11px] font-extrabold uppercase tracking-widest text-slate-500">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-2.5 bg-white/5 hover:bg-white/10 px-3 py-2.5 rounded-xl text-sm text-slate-200 hover:text-white font-medium"
            >
              <Icon size={18} className="text-slate-400 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Site navbar. Priorities: find a property -> book a stay -> get things done,
 * with one gold call-to-action and every account link in a single avatar menu.
 */
export default function Navbar(): ReactNode {
  const t = useTranslations("Header");
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Re-checked on every route change so a login/logout on another page is picked up.
  useEffect(() => {
    const token = localStorage.getItem("access_token");
    setIsLoggedIn(!!token);
    if (token) {
      getMyProfile(token)
        .then((p) => setProfile(p))
        .catch(() => setProfile(null));
    } else {
      setProfile(null);
    }
  }, [pathname]);

  function handleLogOut() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    setIsLoggedIn(false);
    setProfile(null);
    setMobileOpen(false);
    router.push("/");
  }

  const propertiesMenu: NavMenuItem[] = [
    { href: "/search?listing_type=RENT", label: t("rent"), icon: IconHome },
    { href: "/buy", label: t("buy"), icon: IconBuilding },
    { href: "/sell", label: t("sell"), icon: IconFileText },
    { href: "/agents", label: t("findAgent"), icon: IconUsers },
    { href: "/wanted", label: t("wantedBoard"), icon: IconCompass },
  ];
  const staysMenu: NavMenuItem[] = [
    { href: "/hotels", label: t("hotels"), icon: IconHotel },
    { href: "/guest-houses", label: t("guestHouses"), icon: IconBed },
    { href: "/student-hostels", label: t("studentHostels"), icon: IconGraduationCap },
    { href: "/events", label: t("events"), icon: IconParty },
  ];
  const servicesMenu: NavMenuItem[] = [
    { href: "/taskln-service", label: t("homeServices"), icon: IconWrench },
    { href: "/oazigo", label: t("rides"), icon: IconCar },
    { href: "/marketplace", label: t("marketplace"), icon: IconShoppingBag },
    { href: "/trainings", label: t("trainings"), icon: IconGraduationCap },
    { href: "/careers", label: t("careers"), icon: IconBriefcase },
    { href: "/how-it-works", label: t("howItWorks"), icon: IconSparkles },
  ];

  const accountItems = [
    { href: dashboardHrefFor(profile), label: t("dashboard") },
    ...(profile?.is_agent || profile?.is_landlord ? [{ href: "/my-listings", label: t("myListings") }] : []),
    { href: "/bookings", label: t("myBookings") },
    { href: "/wallet", label: t("wallet") },
    { href: "/favorites", label: t("savedProperties") },
    { href: "/saved-searches", label: t("savedSearches") },
    { href: "/account", label: t("myAccount") },
    ...(profile?.is_admin ? [{ href: "/admin", label: t("adminConsole") }] : []),
  ];

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="glass-nav text-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between gap-4 min-h-[72px] py-2">
          <Link href="/" className="flex items-center shrink-0 group">
            <Image
              src="/logo.png"
              alt="Oaziland"
              width={116}
              height={116}
              style={{ width: "auto", height: "56px" }}
              priority
              className="transition-transform duration-200 group-hover:scale-105 object-contain drop-shadow"
            />
          </Link>

          <nav className="hidden md:flex items-center gap-1 min-w-0">
            <NavDropdown label={t("propertiesMenu")} items={propertiesMenu} pathname={pathname} />
            <NavDropdown label={t("staysMenu")} items={staysMenu} pathname={pathname} />
            <NavDropdown label={t("servicesMenu")} items={servicesMenu} pathname={pathname} />
          </nav>

          <HeaderSearch placeholder={t("searchPlaceholder")} label={t("searchLabel")} className="hidden lg:block flex-1 max-w-xs" />

          <div className="hidden md:flex items-center gap-3 shrink-0">
            <LanguageSwitcher />
            {isLoggedIn ? (
              <>
                <Link
                  href="/messages"
                  aria-label={t("messages")}
                  title={t("messages")}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <IconMessageCircle size={22} />
                </Link>
                <AvatarMenu profile={profile} items={accountItems} onLogOut={handleLogOut} logOutLabel={t("logOut")} />
              </>
            ) : (
              <Link href="/login" className="whitespace-nowrap text-sm font-semibold text-slate-200 hover:text-white px-3 py-2 rounded-lg hover:bg-white/10 transition-colors">
                {t("signIn")}
              </Link>
            )}
            <Link
              href="/list-property"
              className="whitespace-nowrap gold-gradient text-[var(--navy)] text-sm px-4 py-2.5 rounded-xl font-bold transition-all duration-200 hover:shadow-lg hover:shadow-amber-500/20 hover:scale-[1.02] flex items-center gap-1.5"
            >
              <span className="text-base leading-none font-black">+</span>
              <span>{t("listAProperty")}</span>
            </Link>
          </div>

          <div className="flex md:hidden items-center gap-2">
            <LanguageSwitcher />
            <button
              className="text-slate-200 hover:text-white p-2 rounded-lg bg-white/5 border border-white/10"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={t("toggleMenu")}
              aria-expanded={mobileOpen}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden py-4 border-t border-white/10 flex flex-col gap-4 animate-rise-in max-h-[80vh] overflow-y-auto">
            <HeaderSearch placeholder={t("searchPlaceholder")} label={t("searchLabel")} />
            <MobileGroup title={t("propertiesMenu")} items={propertiesMenu} onNavigate={closeMobile} />
            <MobileGroup title={t("staysMenu")} items={staysMenu} onNavigate={closeMobile} />
            <MobileGroup title={t("servicesMenu")} items={servicesMenu} onNavigate={closeMobile} />

            <div className="pt-3 border-t border-white/10 flex flex-col gap-3">
              <Link href="/list-property" onClick={closeMobile} className="gold-gradient text-[var(--navy)] text-center py-3 rounded-xl font-bold text-sm">
                + {t("listAProperty")}
              </Link>
              {isLoggedIn ? (
                <div className="grid grid-cols-2 gap-2">
                  {[...accountItems, { href: "/messages", label: t("messages") }].map((item) => (
                    <Link key={item.href} href={item.href} onClick={closeMobile} className="text-center py-2.5 rounded-xl bg-white/10 text-white text-sm font-medium">
                      {item.label}
                    </Link>
                  ))}
                  <button onClick={handleLogOut} className="py-2.5 rounded-xl border border-white/20 text-rose-300 text-sm font-medium">
                    {t("logOut")}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Link href="/login" onClick={closeMobile} className="flex-1 text-center py-2.5 rounded-xl bg-white/10 text-white text-sm font-medium">
                    {t("signIn")}
                  </Link>
                  <Link href="/register" onClick={closeMobile} className="flex-1 text-center py-2.5 rounded-xl border border-white/20 text-white text-sm font-medium">
                    {t("register")}
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

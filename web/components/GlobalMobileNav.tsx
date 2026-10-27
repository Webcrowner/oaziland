"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import MobileTabBar, { type MobileTabItem } from "@/components/MobileTabBar";
import { HeaderSearch, MobileGroup, useSiteMenus } from "@/components/Navbar";
import { SIDEBAR_ROUTES } from "@/components/SiteChrome";
import { IconCompass, IconHome, IconMessageCircle, IconUser, IconX } from "@/components/Icons";

// Focused flows where a site-wide tab bar would only be a distraction.
const HIDDEN_PREFIXES = ["/login", "/register", "/forgot-password", "/reset-password", "/mfa-setup", "/admin"];

const stripSlash = (path: string) => (path.length > 1 ? path.replace(/\/$/, "") : path);
const basePath = (href: string) => href.split("?")[0];

function IconPlus({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Site-wide, phone-only bottom navigation (Home / Explore / List / Messages / Account). */
export default function GlobalMobileNav() {
  const t = useTranslations("MobileNav");
  const th = useTranslations("Header");
  const pathname = stripSlash(usePathname());
  const { propertiesMenu, staysMenu, servicesMenu } = useSiteMenus();
  const [exploreOpen, setExploreOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Re-read on every route change so signing in or out elsewhere is reflected.
  useEffect(() => {
    void Promise.resolve().then(() => {
      setIsLoggedIn(Boolean(localStorage.getItem("access_token")));
      setExploreOpen(false);
    });
  }, [pathname]);

  useEffect(() => {
    if (!exploreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExploreOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [exploreOpen]);

  if (HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;

  const inExploreSection = [...propertiesMenu, ...staysMenu, ...servicesMenu].some((item) => {
    const base = basePath(item.href);
    return pathname === base || pathname.startsWith(`${base}/`);
  });

  const items: MobileTabItem[] = [
    { id: "home", label: t("home"), icon: <IconHome size={22} />, href: "/", active: pathname === "/" && !exploreOpen },
    {
      id: "explore",
      label: t("explore"),
      icon: <IconCompass size={22} />,
      onClick: () => setExploreOpen((open) => !open),
      expanded: exploreOpen,
      active: exploreOpen || inExploreSection,
    },
    { id: "list", label: t("list"), icon: <IconPlus />, href: "/list-property", primary: true, active: pathname === "/list-property" },
    { id: "messages", label: t("messages"), icon: <IconMessageCircle size={22} />, href: "/messages", active: pathname === "/messages" },
    isLoggedIn
      ? {
          id: "account",
          label: t("account"),
          icon: <IconUser size={22} />,
          href: "/account",
          active: pathname !== "/messages" && SIDEBAR_ROUTES.has(pathname),
        }
      : { id: "account", label: t("signIn"), icon: <IconUser size={22} />, href: "/login" },
  ];

  return (
    <>
      {exploreOpen && (
        <div className="md:hidden fixed inset-0 z-[55]">
          <button type="button" aria-label={t("close")} onClick={() => setExploreOpen(false)} className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("exploreTitle")}
            className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] max-h-[78vh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-slate-900 px-4 pb-8 pt-3 text-white shadow-2xl animate-rise-in"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-black tracking-tight">{t("exploreTitle")}</h2>
              <button type="button" onClick={() => setExploreOpen(false)} aria-label={t("close")} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-slate-200 cursor-pointer">
                <IconX size={18} />
              </button>
            </div>
            <div className="flex flex-col gap-5">
              <Link
                href="/videos"
                onClick={() => setExploreOpen(false)}
                className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 py-3 text-slate-900 font-black"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" /></svg>
                <span className="flex-1">{t("videos")}</span>
                <span className="text-xs font-semibold opacity-70">{t("videosHint")}</span>
              </Link>
              <div onSubmitCapture={() => setExploreOpen(false)}>
                <HeaderSearch placeholder={th("searchPlaceholder")} label={th("searchLabel")} />
              </div>
              <MobileGroup title={th("propertiesMenu")} items={propertiesMenu} onNavigate={() => setExploreOpen(false)} />
              <MobileGroup title={th("staysMenu")} items={staysMenu} onNavigate={() => setExploreOpen(false)} />
              <MobileGroup title={th("servicesMenu")} items={servicesMenu} onNavigate={() => setExploreOpen(false)} />
            </div>
          </div>
        </div>
      )}
      <MobileTabBar items={items} label={t("navLabel")} />
    </>
  );
}

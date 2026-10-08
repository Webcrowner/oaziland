"use client";
import { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import SidebarFrame from "@/components/SidebarFrame";
import NavIconImage, { NAV_ICON_BY_HREF } from "@/components/navIcons";
import {
  IconUser,
  IconLock,
  IconShieldCheck,
  IconEyeOff,
  IconCreditCard,
  IconFileText,
  IconStar,
  IconHeart,
  IconSearch,
  IconMessageCircle,
  IconBell,
  IconGift,
  IconSparkles,
} from "@/components/Icons";

interface AccountNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: number;
}

interface AccountNavGroup {
  title: string;
  items: AccountNavItem[];
}

const ACCOUNT_NAV_GROUPS: AccountNavGroup[] = [
  {
    title: "My Profile",
    items: [
      { href: "/account", label: "Profile & Settings", icon: IconUser },
      { href: "/security", label: "Password & Security", icon: IconLock },
      { href: "/kyc", label: "KYC Verification", icon: IconShieldCheck },
      { href: "/privacy-settings", label: "Privacy", icon: IconEyeOff },
    ],
  },
  {
    title: "Activity",
    items: [
      { href: "/bookings", label: "Bookings & Escrow", icon: IconFileText },
      { href: "/wallet", label: "Wallet & Transactions", icon: IconCreditCard },
      { href: "/ratings", label: "Ratings & Reviews", icon: IconStar },
    ],
  },
  {
    title: "Discovery",
    items: [
      { href: "/favorites", label: "Favorites", icon: IconHeart },
      { href: "/saved-searches", label: "Saved Searches", icon: IconSearch },
    ],
  },
  {
    title: "Inbox",
    items: [
      { href: "/messages", label: "Messages", icon: IconMessageCircle },
      { href: "/notifications", label: "Notifications", icon: IconBell },
    ],
  },
  {
    title: "Growth",
    items: [
      { href: "/referrals", label: "Referrals", icon: IconGift },
      { href: "/premium", label: "Premium", icon: IconSparkles },
    ],
  },
];

interface AccountSidebarLayoutProps {
  activeHref: string;
  children: ReactNode;
}

/**
 * Persistent account navigation — every logged-in user lands somewhere
 * inside this sidebar (profile, KYC, security, wallet, bookings,
 * ratings, favorites, messages...) instead of each page being an
 * island only reachable from the /account hub's link grid.
 */
export default function AccountSidebarLayout({ activeHref, children }: AccountSidebarLayoutProps) {
  const sidebar = (
    <div className="flex flex-col gap-4">
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/90 border border-slate-800/80 text-white relative overflow-hidden">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center font-black shadow-md shadow-amber-500/25 shrink-0">
                  <IconUser size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-tight text-white truncate">My Account</p>
                  <p className="text-xs text-slate-400 truncate mt-0.5">Profile &amp; Personal Space</p>
                </div>
              </div>
            </div>

            <nav className="flex flex-col gap-4">
              {ACCOUNT_NAV_GROUPS.map((group) => (
                <div key={group.title} className="space-y-1">
                  <div className="px-3 py-1">
                    <span className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
                      {group.title}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const iconSrc = NAV_ICON_BY_HREF[item.href];
                      const isActive = activeHref === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`group relative w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl text-sm font-bold transition-all duration-150 text-left ${
                            isActive
                              ? "bg-slate-850 text-white border border-slate-700/70 shadow-lg shadow-black/30"
                              : "text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent"
                          }`}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-amber-400" />
                          )}
                          <div
                            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                              isActive
                                ? "bg-amber-400/15 text-amber-300"
                                : "bg-slate-900 text-slate-400 group-hover:bg-slate-800 group-hover:text-slate-200"
                            }`}
                          >
                            {iconSrc ? <NavIconImage src={iconSrc} size={32} /> : <Icon size={32} />}
                          </div>
                          <span className="flex-1 truncate tracking-tight">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
    </div>
  );

  return (
    <SidebarFrame sidebar={sidebar}>
      <div className="py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">{children}</div>
      </div>
    </SidebarFrame>
  );
}

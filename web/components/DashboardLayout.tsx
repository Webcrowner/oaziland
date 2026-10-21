"use client";
import { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import {
  IconDashboard,
  IconBuilding,
  IconBriefcase,
  IconCar,
  IconWrench,
  IconGraduationCap,
  IconCompass,
  IconShield,
  IconCreditCard,
  IconFileText,
  IconStar,
  IconUser,
  IconChevronRight,
  IconArrowUpRight,
} from "@/components/Icons";

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  badge?: string | number;
  isUrgent?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

interface DashboardLayoutProps {
  currentRole: "renter" | "landlord" | "agent" | "student" | "driver" | "technician";
  activeHref: string;
  title: string;
  subtitle?: string;
  badge?: string;
  action?: ReactNode;
  children: ReactNode;
  navGroups?: NavGroup[];
}

const ROLE_NAV: Record<
  "renter" | "landlord" | "agent" | "student" | "driver" | "technician",
  { roleLabel: string; roleIcon: React.ComponentType<{ size?: number; className?: string }>; defaultGroups: NavGroup[] }
> = {
  renter: {
    roleLabel: "Renter & Seeker",
    roleIcon: IconCompass,
    defaultGroups: [
      {
        title: "Activity & Orders",
        items: [
          { href: "/renter-dashboard", label: "Overview & Bookings", icon: IconDashboard },
          { href: "/bookings", label: "My Escrow Bookings", icon: IconCreditCard },
          { href: "/favorites", label: "Saved Properties", icon: IconBuilding },
          { href: "/saved-searches", label: "Search Alerts", icon: IconCompass },
        ],
      },
      {
        title: "Account & Trust",
        items: [
          { href: "/kyc", label: "Identity Verification (KYC)", icon: IconShield },
          { href: "/wallet", label: "In-App Wallet", icon: IconCreditCard },
          { href: "/ratings", label: "My Ratings & Reviews", icon: IconStar },
          { href: "/account", label: "Profile & Settings", icon: IconUser },
        ],
      },
      {
        title: "Explore",
        items: [
          { href: "/search", label: "Browse Rentals & Sales", icon: IconBuilding },
          { href: "/student-hostels", label: "Student Accommodations", icon: IconGraduationCap },
        ],
      },
    ],
  },
  landlord: {
    roleLabel: "Landlord & Owner",
    roleIcon: IconBuilding,
    defaultGroups: [
      {
        title: "Portfolio Management",
        items: [
          { href: "/landlord-portfolio", label: "Portfolio Analytics", icon: IconDashboard },
          { href: "/property-management", label: "Leases & Tenants", icon: IconBuilding },
          { href: "/list-property", label: "Add New Property", icon: IconBuilding },
        ],
      },
      {
        title: "Financials & Account",
        items: [
          { href: "/wallet", label: "Wallet & MoMo Payouts", icon: IconCreditCard },
          { href: "/bookings", label: "Escrow Transactions", icon: IconFileText },
          { href: "/kyc", label: "KYC & Verification", icon: IconShield },
          { href: "/ratings", label: "Reviews & Reputation", icon: IconStar },
          { href: "/account", label: "My Profile & Settings", icon: IconUser },
        ],
      },
      {
        title: "Specialized Properties",
        items: [
          { href: "/host-dashboard", label: "Guest House Hub", icon: IconBuilding },
          { href: "/hotel-dashboard", label: "Hotel Dashboard", icon: IconBuilding },
          { href: "/venue-dashboard", label: "Event Venues Hub", icon: IconBuilding },
        ],
      },
    ],
  },
  agent: {
    roleLabel: "Agent & Broker",
    roleIcon: IconBriefcase,
    defaultGroups: [
      {
        title: "Deal Pipeline",
        items: [
          { href: "/dashboard", label: "Agent Performance", icon: IconDashboard },
          { href: "/agency-dashboard", label: "Agency Team Hub", icon: IconBriefcase },
          { href: "/property-management", label: "Leases & Agreements", icon: IconBuilding },
        ],
      },
      {
        title: "Earnings & Verification",
        items: [
          { href: "/wallet", label: "Commission Wallet & Payouts", icon: IconCreditCard },
          { href: "/kyc", label: "Agent License & KYC", icon: IconShield },
          { href: "/ratings", label: "Client Testimonials & Rating", icon: IconStar },
          { href: "/account", label: "Profile & Settings", icon: IconUser },
        ],
      },
      {
        title: "Client Network",
        items: [
          { href: "/agents", label: "Agent Directory", icon: IconBriefcase },
          { href: "/list-property", label: "List For Client", icon: IconBuilding },
        ],
      },
    ],
  },
  student: {
    roleLabel: "Student Resident",
    roleIcon: IconGraduationCap,
    defaultGroups: [
      {
        title: "Housing Hub",
        items: [
          { href: "/student-dashboard", label: "My Hostel & Room", icon: IconDashboard },
          { href: "/student-hostels", label: "Browse Hostels", icon: IconGraduationCap },
          { href: "/bookings", label: "Escrow Receipts", icon: IconCreditCard },
        ],
      },
      {
        title: "My Account & Trust",
        items: [
          { href: "/kyc", label: "Student Verification (KYC)", icon: IconShield },
          { href: "/ratings", label: "My Reviews", icon: IconStar },
          { href: "/account", label: "Profile & Settings", icon: IconUser },
        ],
      },
    ],
  },
  driver: {
    roleLabel: "OaziGo Driver",
    roleIcon: IconCar,
    defaultGroups: [
      {
        title: "Ride Ops",
        items: [
          { href: "/driver-dashboard", label: "Driver Control Hub", icon: IconDashboard },
          { href: "/oazigo", label: "Live Ride Queue", icon: IconCar },
        ],
      },
      {
        title: "Earnings & Trust",
        items: [
          { href: "/wallet", label: "Wallet & MoMo Payouts", icon: IconCreditCard },
          { href: "/kyc", label: "Driver Identity & License", icon: IconShield },
          { href: "/ratings", label: "Driver Rating & Reviews", icon: IconStar },
          { href: "/account", label: "Profile & Settings", icon: IconUser },
        ],
      },
    ],
  },
  technician: {
    roleLabel: "Taskln Technician",
    roleIcon: IconWrench,
    defaultGroups: [
      {
        title: "Service Operations",
        items: [
          { href: "/technician-dashboard", label: "Earnings & Performance", icon: IconDashboard },
          { href: "/taskln-service", label: "Accept Service Jobs", icon: IconWrench },
        ],
      },
      {
        title: "Finances & Verification",
        items: [
          { href: "/wallet", label: "Wallet & MoMo Payouts", icon: IconCreditCard },
          { href: "/kyc", label: "Artisan Verification (KYC)", icon: IconShield },
          { href: "/ratings", label: "Technician Ratings", icon: IconStar },
          { href: "/account", label: "Profile & Settings", icon: IconUser },
        ],
      },
    ],
  },
};

const ALL_ROLES_SHORTCUTS = [
  { role: "renter", label: "Renter Hub", href: "/renter-dashboard", icon: IconCompass },
  { role: "landlord", label: "Landlord", href: "/landlord-portfolio", icon: IconBuilding },
  { role: "agent", label: "Agent", href: "/dashboard", icon: IconBriefcase },
  { role: "student", label: "Student", href: "/student-dashboard", icon: IconGraduationCap },
  { role: "driver", label: "OaziGo", href: "/driver-dashboard", icon: IconCar },
  { role: "technician", label: "Taskln", href: "/technician-dashboard", icon: IconWrench },
] as const;

export default function DashboardLayout({
  currentRole,
  activeHref,
  title,
  subtitle,
  badge,
  action,
  children,
  navGroups,
}: DashboardLayoutProps) {
  const roleConfig = ROLE_NAV[currentRole];
  const RoleIcon = roleConfig.roleIcon;
  const groupsToRender = navGroups || roleConfig.defaultGroups;

  return (
    <div className="min-h-screen bg-slate-50/70 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Top Header Bar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-200">
                <RoleIcon size={12} className="text-amber-700" />
                <span>{roleConfig.roleLabel}</span>
              </span>
              {badge && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">
                  {badge}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {title}
            </h1>
            {subtitle && <p className="text-xs sm:text-sm text-slate-500 mt-1">{subtitle}</p>}
          </div>

          {action && <div className="self-start md:self-auto">{action}</div>}
        </div>

        {/* Mobile Horizontal Switcher Bar */}
        <div className="lg:hidden mb-6 overflow-x-auto pb-2 scrollbar-none flex gap-2">
          {ALL_ROLES_SHORTCUTS.map((item) => {
            const isCurrentRole = item.role === currentRole;
            const Icon = item.icon;
            return (
              <Link
                key={item.role}
                href={item.href}
                className={`whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 border ${
                  isCurrentRole
                    ? "bg-slate-950 text-white border-slate-900 shadow-sm"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                <Icon size={13} className={isCurrentRole ? "text-amber-400" : "text-slate-400"} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Layout Grid: Dark Professional Sidebar + Main Area */}
        <div className="lg:flex lg:gap-8 lg:items-start">
          {/* Dark Sidebar */}
          <aside className="hidden lg:block w-72 xl:w-80 shrink-0 sticky top-24 self-start">
            <div className="bg-slate-950 border border-slate-800/90 rounded-3xl p-3.5 shadow-2xl shadow-slate-950/60 flex flex-col gap-4 text-slate-300">
              {/* Identity Card */}
              <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/90 border border-slate-800/80 text-white relative overflow-hidden">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center font-black shadow-md shadow-amber-500/25 shrink-0">
                    <RoleIcon size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black tracking-tight text-white truncate">
                      {roleConfig.roleLabel}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      Verified Workspace
                    </p>
                  </div>
                </div>
              </div>

              {/* Navigation Groups */}
              <nav className="flex flex-col gap-4">
                {groupsToRender.map((group) => (
                  <div key={group.title} className="space-y-1">
                    <div className="px-3 py-1">
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                        {group.title}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const Icon = item.icon || IconDashboard;
                        const isActive = activeHref === item.href;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-xs font-bold transition-all duration-150 text-left ${
                              isActive
                                ? "bg-slate-850 text-white border border-slate-700/70 shadow-lg shadow-black/30"
                                : "text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent"
                            }`}
                          >
                            {isActive && (
                              <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-amber-400" />
                            )}
                            <div
                              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                                isActive
                                  ? "bg-amber-400/15 text-amber-300"
                                  : "bg-slate-900 text-slate-400 group-hover:bg-slate-800 group-hover:text-slate-200"
                              }`}
                            >
                              <Icon size={16} />
                            </div>
                            <span className="flex-1 truncate tracking-tight">{item.label}</span>
                            {item.badge !== undefined && (
                              <span
                                className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                                  isActive
                                    ? "bg-amber-400 text-slate-950"
                                    : item.isUrgent
                                    ? "bg-rose-950/80 text-rose-300 border border-rose-800/80"
                                    : "bg-amber-950/80 text-amber-300 border border-amber-800/80"
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>

              {/* Hub Switching & Account shortcuts */}
              <div className="pt-2 border-t border-slate-850 flex flex-col gap-2">
                <div className="px-3 pt-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                    Switch Persona Hub
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 px-1">
                  {ALL_ROLES_SHORTCUTS.map((item) => (
                    <Link
                      key={item.role}
                      href={item.href}
                      className={`text-[11px] font-bold px-2 py-1.5 rounded-lg transition-colors truncate ${
                        item.role === currentRole
                          ? "bg-amber-400/15 text-amber-300"
                          : "text-slate-400 hover:text-white hover:bg-slate-900"
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-850/80 flex items-center justify-between px-2 text-[11px]">
                  <Link href="/account" className="text-slate-400 hover:text-white font-bold">
                    My Account
                  </Link>
                  <Link href="/" className="text-slate-400 hover:text-white font-bold flex items-center gap-1">
                    <span>Portal Home</span>
                    <IconArrowUpRight size={12} />
                  </Link>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Content Area */}
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

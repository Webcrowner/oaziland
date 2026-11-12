"use client";
import { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";

// Pages whose layout (DashboardLayout / AccountSidebarLayout) owns navigation via its sidebar.
export const SIDEBAR_ROUTES = new Set([
  "/dashboard",
  "/renter-dashboard",
  "/landlord-portfolio",
  "/agency-dashboard",
  "/driver-dashboard",
  "/host-dashboard",
  "/hotel-dashboard",
  "/venue-dashboard",
  "/student-dashboard",
  "/technician-dashboard",
  "/property-management",
  "/my-listings",
  "/account",
  "/bookings",
  "/favorites",
  "/kyc",
  "/messages",
  "/my-learning",
  "/notifications",
  "/parent-portal",
  "/premium",
  "/privacy-settings",
  "/ratings",
  "/referrals",
  "/saved-searches",
  "/security",
  "/wallet",
]);

/** True for the admin console and its sign-in page, which run without the public site's top navbar. */
export const isAdminRoute = (pathname: string) => /^\/admin(\/|$)/.test(pathname.replace(/\/$/, "") + "/");

/**
 * Renders its children (the global Header/Footer) everywhere except sidebar-driven pages.
 * With `hideOnAdmin`, it also hides them on the admin console and its sign-in page.
 */
export default function SiteChrome({ children, hideOnAdmin = false }: { children: ReactNode; hideOnAdmin?: boolean }) {
  const pathname = usePathname();
  if (SIDEBAR_ROUTES.has(pathname.replace(/\/$/, ""))) return null;
  if (hideOnAdmin && isAdminRoute(pathname)) return null;
  return <>{children}</>;
}

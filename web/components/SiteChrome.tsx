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

/** Renders its children (the global Header/Footer) everywhere except sidebar-driven pages. */
export default function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (SIDEBAR_ROUTES.has(pathname.replace(/\/$/, ""))) return null;
  return <>{children}</>;
}

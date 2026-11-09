"use client";
import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { API_BASE_URL } from "@/lib/api";

/**
 * Sends one anonymous page-view ping per page the visitor opens, for the admin console's
 * visitor statistics. It sets no cookies and sends no personal data (the server works out
 * device and country itself). It stays silent on admin pages and for anyone who has turned
 * on Do Not Track or Global Privacy Control.
 */
export default function VisitorTracker() {
  const pathname = usePathname();
  const locale = useLocale();
  const firstView = useRef(true);
  const lastPath = useRef("");

  useEffect(() => {
    if (!pathname || pathname === "/admin" || pathname.startsWith("/admin/")) return;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;

    // Only the page the visitor landed on has an outside referrer; later pages are internal navigation.
    const referrer = firstView.current ? document.referrer : "";
    firstView.current = false;

    fetch(`${API_BASE_URL}/api/analytics/visit/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        path: pathname,
        referrer,
        locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen_width: window.screen?.width,
        signed_in: Boolean(localStorage.getItem("access_token")),
      }),
    }).catch(() => {});
  }, [pathname, locale]);

  return null;
}

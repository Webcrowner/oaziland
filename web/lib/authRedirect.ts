/** Sending people to sign in and bringing them back to where they were (`/login?next=/trainings/…`). */

/** A same-site path to return to after signing in, or null. Paths are locale-less (the i18n router adds the locale);
 * "//host" and "/\host" are rejected since browsers treat them as links to another site. */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

/** The sign-in page, returning to `path` (a locale-less path such as usePathname() from @/i18n/navigation gives). */
export function loginHref(path: string, page: "/login" | "/register" = "/login"): string {
  const next = safeNextPath(path);
  return next ? `${page}?next=${encodeURIComponent(next)}` : page;
}

/** The current page (locale-less path + query string) as a return path; call it in the browser only. */
export function currentPath(pathname: string): string {
  return typeof window === "undefined" ? pathname : `${pathname}${window.location.search}`;
}

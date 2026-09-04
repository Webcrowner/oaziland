import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);
// Renamed from middleware.ts to proxy.ts per Next.js 16's naming convention update.

export const config = {
  // Matches every route except static files, Next.js internals, and
  // the service worker/manifest (which must stay locale-independent).
  matcher: ["/((?!api|_next|_vercel|sw\\.js|manifest\\.json|.*\\..*).*)"],
};

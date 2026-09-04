import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware versions of Link/useRouter/usePathname/redirect — using
// these instead of next/navigation's directly keeps every internal
// link correctly prefixed with the current locale automatically.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

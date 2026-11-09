"use client";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** A simple language toggle — switches locale while staying on the
 * exact same page (a user reading a listing in English who switches
 * to French should land on the SAME listing in French, not the
 * homepage). */
export default function LanguageSwitcher({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(nextLocale: string) {
    // Keep the query string too (a filtered search, an admin tab...), not only the path.
    const query = Object.fromEntries(new URLSearchParams(window.location.search));
    router.replace({ pathname, query }, { locale: nextLocale });
  }

  const inactive = variant === "light" ? "text-slate-500 hover:text-slate-900" : "text-gray-300 hover:text-white";

  return (
    <div className="flex items-center gap-1 text-sm">
      {routing.locales.map((loc) => (
        <button
          key={loc}
          onClick={() => switchTo(loc)}
          className={`px-2 py-1 rounded transition-colors ${
            locale === loc ? "bg-[var(--gold)] text-[var(--navy)] font-semibold" : inactive
          }`}
          aria-current={locale === loc}
        >
          {loc.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

"use client";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** A simple language toggle — switches locale while staying on the
 * exact same page (a user reading a listing in English who switches
 * to French should land on the SAME listing in French, not the
 * homepage). */
export default function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchTo(nextLocale: string) {
    router.replace(pathname, { locale: nextLocale });
  }

  return (
    <div className="flex items-center gap-1 text-sm">
      {routing.locales.map((loc) => (
        <button
          key={loc}
          onClick={() => switchTo(loc)}
          className={`px-2 py-1 rounded transition-colors ${
            locale === loc ? "bg-[#C9A227] text-[#1B2A4A] font-semibold" : "text-gray-300 hover:text-white"
          }`}
          aria-current={locale === loc}
        >
          {loc.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

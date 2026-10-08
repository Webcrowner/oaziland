import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Real 404 page for anything under a locale route — previously
 * missing entirely, so an unmatched URL (e.g. a deleted listing link)
 * fell through to Next.js's bare default 404 instead of an on-brand
 * page with real navigation back into the app.
 */
export default function LocaleNotFound() {
  const t = useTranslations("NotFoundPage");

  return (
    <main className="max-w-md mx-auto px-4 py-20 text-center">
      <p className="text-4xl mb-4">🧭</p>
      <h1 className="text-xl font-bold text-[var(--navy)] mb-2">{t("title")}</h1>
      <p className="text-sm text-gray-500 mb-8">{t("message")}</p>
      <Link href="/" className="inline-block bg-[var(--navy)] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
        {t("goHome")}
      </Link>
    </main>
  );
}

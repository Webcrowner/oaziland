"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Button from "@/components/ui/Button";

/**
 * Route-segment error boundary — previously MISSING entirely: an
 * unhandled exception anywhere under a locale route would fall through
 * to Next.js's bare default error screen instead of a real, on-brand
 * recovery page. Kept as a client component per Next.js's error.tsx
 * contract (it needs the reset() callback from the error boundary).
 */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("ErrorBoundary");

  return (
    <main className="max-w-md mx-auto px-4 py-20 text-center">
      <p className="text-4xl mb-4">⚠️</p>
      <h1 className="text-xl font-bold text-[var(--navy)] mb-2">{t("title")}</h1>
      <p className="text-sm text-gray-500 mb-8">{t("message")}</p>
      <div className="flex items-center justify-center gap-3">
        <Button onClick={reset}>{t("retry")}</Button>
        <Link href="/" className="text-sm font-semibold text-gray-600 underline">
          {t("goHome")}
        </Link>
      </div>
    </main>
  );
}

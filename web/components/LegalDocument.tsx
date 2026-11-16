import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentPolicy } from "@/lib/api";

/** Shows the current published Terms of Service or Privacy Policy exactly as the team published it. */
export default async function LegalDocument({ type }: { type: "TERMS_OF_SERVICE" | "PRIVACY_POLICY" }) {
  const t = await getTranslations("LegalPage");
  const policy = await getCurrentPolicy(type).catch(() => null);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-2 font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--navy)]">
        {t(type === "TERMS_OF_SERVICE" ? "terms_title" : "privacy_title")}
      </h1>
      {policy ? (
        <>
          <p className="mb-6 text-xs text-slate-500">{t("version", { version: policy.version })}</p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{policy.body_text}</div>
        </>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t("notPublished")}</p>
      )}
      <p className="mt-10 text-sm text-slate-500">
        {t("contactLine")}{" "}
        <Link href="/contact" className="font-semibold text-[var(--navy)] underline">{t("contact")}</Link>
      </p>
    </main>
  );
}

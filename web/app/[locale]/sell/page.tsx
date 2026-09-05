import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Vendez Votre Propriété | Oaziland" : "Sell Your Property | Oaziland",
    description: locale === "fr"
      ? "Atteignez des milliers d'acheteurs vérifiés à travers le Cameroun."
      : "Reach thousands of verified buyers across Cameroon.",
  };
}

/**
 * A dedicated landing page for sellers — reuses the EXISTING list-
 * property flow (which itself correctly enforces MFA+KYC) rather than
 * a separate seller-specific form.
 */
export default async function SellPage() {
  const t = await getTranslations("SellPage");

  return (
    <main className="bg-[#1B2A4A] text-white py-20 px-4 text-center">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-bold mb-4">{t("title")}</h1>
        <p className="text-gray-300 mb-8">{t("subtitle")}</p>
        <Link
          href="/list-property"
          className="inline-block bg-[#C9A227] text-[#1B2A4A] font-semibold px-8 py-3 rounded transition-all duration-150 hover:opacity-90 hover:scale-[1.03]"
        >
          {t("cta")}
        </Link>
      </div>
    </main>
  );
}

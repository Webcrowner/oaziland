import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "À Propos d'Oaziland" : "About Oaziland",
    description: locale === "fr"
      ? "Oaziland est une plateforme Glorentech™ pour l'immobilier au Cameroun."
      : "Oaziland is a Glorentech™ platform for real estate in Cameroon.",
  };
}

export default async function AboutPage() {
  const t = await getTranslations("AboutPage");

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--navy)] mb-6">{t("title")}</h1>
      <p className="text-gray-700 mb-8 text-lg">{t("intro")}</p>

      <h2 className="text-xl font-semibold text-[var(--navy)] mb-2">{t("missionTitle")}</h2>
      <p className="text-gray-700 mb-8">{t("missionText")}</p>

      <h2 className="text-xl font-semibold text-[var(--navy)] mb-2">{t("basedTitle")}</h2>
      <p className="text-gray-700">{t("basedText")}</p>
    </main>
  );
}

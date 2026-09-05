import { getTranslations } from "next-intl/server";
import { listTrainings } from "@/lib/api";
import TrainingCatalog from "@/components/TrainingCatalog";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Formation & Cours | Oaziland" : "Training & Courses | Oaziland",
    description: locale === "fr"
      ? "Gestion immobilière, droit locatif et préparation aux licences."
      : "Property management, tenant law, and licensing prep.",
  };
}

export default async function TrainingsPage() {
  const t = await getTranslations("TrainingPage");
  const data = await listTrainings().catch(() => ({ count: 0, results: [] }));

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-8">{t("subtitle")}</p>

      {data.results.length === 0 ? (
        <p className="text-gray-500">{t("noTrainingsYet")}</p>
      ) : (
        <TrainingCatalog programs={data.results} />
      )}
    </main>
  );
}

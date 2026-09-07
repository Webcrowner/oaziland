import { getTranslations } from "next-intl/server";
import { listTrainings } from "@/lib/api";
import TrainingCatalog from "@/components/TrainingCatalog";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
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
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="🎓" title={t("noTrainingsYet")} />
      ) : (
        <TrainingCatalog programs={data.results} />
      )}
    </main>
  );
}

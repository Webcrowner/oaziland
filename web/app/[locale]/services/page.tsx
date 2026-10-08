import { getTranslations } from "next-intl/server";
import { listServiceCategories } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import RequestServiceButton from "@/components/RequestServiceButton";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Services Partenaires | Oaziland" : "Partner Services | Oaziland",
    description: locale === "fr"
      ? "Photographie, financement, déménagement et autres services de confiance pour votre projet immobilier."
      : "Photography, financing, moving, and other trusted services for your property journey.",
  };
}

export default async function ServicesPage() {
  const t = await getTranslations("ServicesPage");
  const data = await listServiceCategories().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="🛎️" title={t("noServicesYet")} />
      ) : (
        <div className="flex flex-col gap-8">
          {data.results.map((category) => (
            <div key={category.id}>
              <h2 className="text-lg font-semibold text-[var(--navy)] mb-3 border-b pb-2">{category.name}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {category.offerings.map((offering) => (
                  <div key={offering.id} className="border rounded-lg p-4 bg-white transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                    <p className="font-semibold text-[var(--navy)] mb-1">{offering.name}</p>
                    {offering.description && <p className="text-sm text-gray-600 mb-2">{offering.description}</p>}
                    <p className="text-sm font-semibold text-[var(--gold)]">
                      {offering.price_hint_xaf ? t("priceFrom", { price: Number(offering.price_hint_xaf).toLocaleString() }) : t("priceOnRequest")}
                    </p>
                    <RequestServiceButton offeringId={Number(offering.id)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

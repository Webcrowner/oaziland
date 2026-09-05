import { getTranslations } from "next-intl/server";
import { listServiceCategories } from "@/lib/api";
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
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-8">{t("subtitle")}</p>

      {data.results.length === 0 ? (
        <p className="text-gray-500">{t("noServicesYet")}</p>
      ) : (
        <div className="flex flex-col gap-8">
          {data.results.map((category) => (
            <div key={category.id}>
              <h2 className="text-lg font-semibold text-[#1B2A4A] mb-3 border-b pb-2">{category.name}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {category.offerings.map((offering) => (
                  <div key={offering.id} className="border rounded-lg p-4 bg-white transition-shadow hover:shadow-md">
                    <p className="font-semibold text-[#1B2A4A] mb-1">{offering.name}</p>
                    {offering.description && <p className="text-sm text-gray-600 mb-2">{offering.description}</p>}
                    <p className="text-sm font-semibold text-[#C9A227]">
                      {offering.price_hint_xaf ? t("priceFrom", { price: Number(offering.price_hint_xaf).toLocaleString() }) : t("priceOnRequest")}
                    </p>
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

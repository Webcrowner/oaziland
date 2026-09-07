import { getTranslations } from "next-intl/server";
import { searchGuestHouses } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Maisons d'Hôtes au Cameroun | Oaziland" : "Guest Houses in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Des logements de courte durée à travers le Cameroun, y compris des sites balnéaires à Kribi et Limbe."
      : "Short-stay lodges across Cameroon, including coastal leisure spots in Kribi and Limbe.",
  };
}

/**
 * Guest Houses — brought onto the shared UI foundation, same pattern
 * as Events. A real amenities badge row now shows here too — the
 * data already existed on GuestHouseLodge (inherited from
 * PropertyAsset, the same field property listings use) but was never
 * exposed by this app's own serializer until this pass.
 */
export default async function GuestHousesPage() {
  const t = await getTranslations("GuestHousesPage");
  const tCard = await getTranslations("PropertyCard");
  const data = await searchGuestHouses().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="🏡" title={t("noGuestHousesYet")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((gh) => (
            <Card key={gh.id}>
              <CardMedia label={tCard("noPhotoYet")} />
              <CardBody>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <p className="text-sm text-gray-500">📍 {gh.quarter_name}</p>
                  {gh.is_coastal_leisure && <Badge variant="gold">{t("coastalLeisure")}</Badge>}
                </div>
                {gh.amenities.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {gh.amenities.slice(0, 4).map((a) => (
                      <span key={a} className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                        {t(`amenity_${a}`)}
                      </span>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}

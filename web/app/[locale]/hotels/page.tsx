import { getTranslations } from "next-intl/server";
import { searchHotels } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Hôtels Vérifiés au Cameroun | Oaziland" : "Verified Hotels in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Réservez des hôtels vérifiés à travers le Cameroun avec tarification en temps réel et paiement Mobile Money sécurisé."
      : "Book verified hotels across Cameroon with real-time pricing and secure Mobile Money payment.",
  };
}

/**
 * Hotels — the first page rebuilt on the new shared UI foundation
 * (PageHeader, Card/CardMedia/CardBody, EmptyState), proving those
 * components work in a real page before rolling them out further.
 * Same real data-fetching pattern as before — this is a visual
 * consolidation, not a functional change.
 */
export default async function HotelsPage() {
  const t = await getTranslations("HotelsPage");
  const tCard = await getTranslations("PropertyCard");
  const data = await searchHotels().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="🏨" title={t("noHotelsYet")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((hotel) => {
            const cheapestRoom = hotel.room_types.length
              ? hotel.room_types.reduce((min, rt) => (Number(rt.base_rate_xaf) < Number(min.base_rate_xaf) ? rt : min))
              : null;

            return (
              <Card key={hotel.id}>
                <CardMedia label={tCard("noPhotoYet")} />
                <CardBody>
                  <p className="text-sm text-gray-500 mb-1">{hotel.quarter_name}</p>
                  {hotel.star_rating && (
                    <p className="text-sm text-[var(--gold)] font-semibold mb-1">
                      {"★".repeat(hotel.star_rating)}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mb-2">
                    {hotel.room_types.length === 1
                      ? t("roomsAvailable", { count: hotel.room_types.length })
                      : t("roomsAvailableOther", { count: hotel.room_types.length })}
                  </p>
                  {cheapestRoom && (
                    <p className="text-lg font-bold text-[var(--navy)]">
                      {t("from")} {Number(cheapestRoom.base_rate_xaf).toLocaleString()} XAF
                      <span className="text-sm font-normal text-gray-500"> {t("perNight")}</span>
                    </p>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

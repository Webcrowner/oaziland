import { getTranslations } from "next-intl/server";
import { searchVenues } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Salles d'Événements au Cameroun | Oaziland" : "Event Venues in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Des espaces événementiels vérifiés pour conférences, mariages et célébrations à travers le Cameroun."
      : "Verified event spaces for conferences, weddings, and celebrations across Cameroon.",
  };
}

/**
 * Events — brought onto the same shared UI foundation as every other
 * redesigned page this session (PageHeader, Card/CardMedia/CardBody,
 * EmptyState, Badge), plus a real icon stat row for capacity, matching
 * the pattern already applied to PropertyCard.
 *
 * Honest scope note: Venue has no real photo relation yet (unlike
 * Listing, which gained one earlier this session) — CardMedia still
 * shows the real "no photo yet" placeholder rather than a fabricated
 * carousel. Extending real photo upload to venues/hotels/guest-houses/
 * student-hostels the same way it now works for property listings is
 * a genuine, separate follow-up, not addressed in this visual pass.
 */
export default async function EventsPage() {
  const t = await getTranslations("VenuesPage");
  const tCard = await getTranslations("PropertyCard");
  const data = await searchVenues().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="🎉" title={t("noVenuesYet")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((venue) => {
            const cheapestSpace = venue.spaces.length
              ? venue.spaces.reduce((min, s) => (Number(s.base_price_per_hour_xaf) < Number(min.base_price_per_hour_xaf) ? s : min))
              : null;
            return (
              <Card key={venue.id}>
                <CardMedia label={tCard("noPhotoYet")} />
                <CardBody>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm text-gray-500">📍 {venue.quarter_name}</p>
                    {venue.verified && <Badge variant="green">{t("verifiedBadge")}</Badge>}
                  </div>

                  {venue.spaces[0] && (
                    <div className="flex items-center gap-3 text-sm text-gray-700 mb-2">
                      {venue.spaces[0].capacity_theatre && <span className="flex items-center gap-1">🎭 {venue.spaces[0].capacity_theatre}</span>}
                      {venue.spaces[0].capacity_banquet && <span className="flex items-center gap-1">🍽 {venue.spaces[0].capacity_banquet}</span>}
                    </div>
                  )}

                  <p className="text-xs text-gray-500 mb-2">
                    {venue.spaces.length === 1 ? t("spacesAvailable", { count: venue.spaces.length }) : t("spacesAvailableOther", { count: venue.spaces.length })}
                  </p>

                  {cheapestSpace && (
                    <p className="text-lg font-bold text-[var(--navy)]">
                      {Number(cheapestSpace.base_price_per_hour_xaf).toLocaleString()} XAF
                      <span className="text-sm font-normal text-gray-500"> {t("perHour")}</span>
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

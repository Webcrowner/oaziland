import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getVenue } from "@/lib/api";
import AssetDetailView from "@/components/AssetDetailView";

export default async function VenueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("AssetDetail");
  const venue = await getVenue(id).catch(() => null);
  if (!venue) notFound();

  const cheapest = venue.spaces.length
    ? Math.min(...venue.spaces.map((s) => Number(s.base_price_per_hour_xaf)))
    : null;

  return (
    <AssetDetailView
      backHref="/events"
      backLabel={t("backToVenues")}
      title={t("venueIn", { quarter: venue.quarter_name })}
      shareTitle="event venue"
      location={venue.quarter_name}
      photos={venue.photos}
      listerRole={venue.lister_role}
      ownerId={venue.owner}
      ownerName={venue.owner_name}
      verified={venue.verified}
      description={venue.description}
      amenities={venue.amenities}
      facts={[{ label: t("spaces"), value: String(venue.spaces.length) }]}
      sectionTitle={t("eventSpaces")}
      rows={venue.spaces.map((s) => ({
        primary: s.space_name,
        secondary: [
          s.capacity_theatre ? `${s.capacity_theatre} ${t("theatre")}` : "",
          s.capacity_banquet ? `${s.capacity_banquet} ${t("banquet")}` : "",
          s.capacity_cocktail ? `${s.capacity_cocktail} ${t("cocktail")}` : "",
          s.capacity_classroom ? `${s.capacity_classroom} ${t("classroom")}` : "",
          s.catering_policy ? s.catering_policy.replace(/_/g, " ").toLowerCase() : "",
        ].filter(Boolean).join(" · "),
        right: `${Number(s.base_price_per_hour_xaf).toLocaleString()} XAF ${t("perHour")}`,
      }))}
      latitude={venue.latitude}
      longitude={venue.longitude}
      sharePath={`/events/${venue.id}`}
      mediaEndpoint="venues"
      assetId={venue.id}
      sharePrice={cheapest !== null ? cheapest.toLocaleString() : undefined}
    />
  );
}

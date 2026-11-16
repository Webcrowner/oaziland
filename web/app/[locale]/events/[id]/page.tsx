import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getVenue } from "@/lib/api";
import AssetDetailView from "@/components/AssetDetailView";
import VenueSpacesBooking from "@/components/VenueSpacesBooking";

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
      shareTitle={venue.spaces.map((s) => s.space_name).filter(Boolean).join(", ") || t("venueIn", { quarter: venue.quarter_name })}
      location={venue.quarter_name}
      photos={venue.photos}
      listerRole={venue.lister_role}
      ownerId={venue.owner}
      ownerName={venue.owner_name}
      verified={venue.verified}
      description={venue.description}
      amenities={venue.amenities}
      facts={[{ label: t("spaces"), value: String(venue.spaces.length) }]}
      detailsSlot={<VenueSpacesBooking venue={venue} />}
      latitude={venue.latitude}
      longitude={venue.longitude}
      sharePath={`/events/${venue.id}`}
      report={{ kind: "venue", id: String(venue.id) }}
      reviews={{ kind: "venue", id: String(venue.id) }}
      mediaEndpoint="venues"
      assetId={venue.id}
      sharePrice={cheapest !== null ? cheapest.toLocaleString() : undefined}
    />
  );
}

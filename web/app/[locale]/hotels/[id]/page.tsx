import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getHotel } from "@/lib/api";
import AssetDetailView from "@/components/AssetDetailView";

export default async function HotelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("AssetDetail");
  const hotel = await getHotel(id).catch(() => null);
  if (!hotel) notFound();

  const cheapest = hotel.room_types.length
    ? Math.min(...hotel.room_types.map((r) => Number(r.base_rate_xaf)))
    : null;

  const facts = [{ label: t("rooms"), value: String(hotel.total_rooms) }];
  if (hotel.star_rating) facts.unshift({ label: t("stars"), value: String(hotel.star_rating) });

  return (
    <AssetDetailView
      backHref="/hotels"
      backLabel={t("backToHotels")}
      title={t("hotelIn", { quarter: hotel.quarter_name })}
      shareTitle="hotel"
      location={hotel.quarter_name}
      photos={hotel.photos}
      listerRole={hotel.lister_role}
      ownerId={hotel.owner}
      ownerName={hotel.owner_name}
      verified={hotel.verified}
      description={hotel.description}
      amenities={hotel.amenities}
      facts={facts}
      sectionTitle={t("roomTypes")}
      rows={hotel.room_types.map((r) => ({
        primary: r.category.replace(/_/g, " ").toLowerCase(),
        secondary: [t("sleeps", { count: r.capacity }), ...(r.amenities ?? []).map((a) => a.replace(/_/g, " ").toLowerCase())].join(" · "),
        right: `${Number(r.base_rate_xaf).toLocaleString()} XAF ${t("perNight")}`,
      }))}
      latitude={hotel.latitude}
      longitude={hotel.longitude}
      sharePath={`/hotels/${hotel.id}`}
      mediaEndpoint="hotels"
      assetId={hotel.id}
      sharePrice={cheapest !== null ? cheapest.toLocaleString() : undefined}
    />
  );
}

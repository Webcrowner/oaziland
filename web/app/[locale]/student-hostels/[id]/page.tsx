import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getStudentHostel } from "@/lib/api";
import AssetDetailView from "@/components/AssetDetailView";
import HostelRoomTypes from "@/components/HostelRoomTypes";

export default async function StudentHostelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("AssetDetail");
  const tRooms = await getTranslations("HostelRoomTypes");
  const locale = await getLocale();
  const hostel = await getStudentHostel(id).catch(() => null);
  if (!hostel) notFound();

  const roomTypes = hostel.room_types ?? [];
  const title = hostel.name || t("hostelIn", { quarter: hostel.quarter_name });
  const totalBeds = hostel.units.reduce((sum, u) => sum + (u.bed_capacity || 0), 0);
  const facts = [{ label: t("units"), value: String(hostel.units.length) }];
  if (totalBeds > 0) facts.push({ label: t("beds"), value: String(totalBeds) });
  const freePlaces = roomTypes.reduce((sum, r) => sum + r.available_places, 0);
  if (roomTypes.length > 0) facts.push({ label: tRooms("placesFree"), value: String(freePlaces) });
  const priceText = hostel.from_price
    ? tRooms(`fromPricePer_${hostel.from_price.price_period}`, { price: new Intl.NumberFormat(locale).format(Number(hostel.from_price.price_xaf)) })
    : undefined;

  return (
    <AssetDetailView
      backHref="/student-hostels"
      backLabel={t("backToHostels")}
      title={title}
      priceText={priceText}
      shareTitle={title}
      location={hostel.quarter_name}
      photos={hostel.photos}
      listerRole={hostel.lister_role}
      ownerId={hostel.owner}
      ownerName={hostel.owner_name}
      description={hostel.description}
      amenities={hostel.amenities}
      facts={facts}
      detailsSlot={<HostelRoomTypes sharePath={`/student-hostels/${hostel.id}`} hostelTitle={title} quarterName={hostel.quarter_name} roomTypes={roomTypes} />}
      // Hostels not yet set up with room types still list their rooms plainly.
      sectionTitle={roomTypes.length === 0 ? t("hostelUnits") : undefined}
      rows={roomTypes.length === 0 ? hostel.units.map((u) => ({
        primary: `${u.room_code} · ${u.unit_type.replace(/_/g, " ").toLowerCase()}`,
        secondary: [u.occupancy_model, u.amenity_tier].filter(Boolean).map((v) => v.replace(/_/g, " ").toLowerCase()).join(" · "),
        right: u.bed_capacity ? `${u.bed_capacity} ${t("beds")}` : undefined,
      })) : []}
      latitude={hostel.latitude}
      longitude={hostel.longitude}
      sharePath={`/student-hostels/${hostel.id}`}
      sharePrice={priceText}
      report={{ kind: "student_hostel", id: String(hostel.id) }}
      reviews={{ kind: "hostel", id: String(hostel.id) }}
      mediaEndpoint="student-hostels"
      assetId={hostel.id}
    />
  );
}

import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getStudentHostel } from "@/lib/api";
import AssetDetailView from "@/components/AssetDetailView";

export default async function StudentHostelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("AssetDetail");
  const hostel = await getStudentHostel(id).catch(() => null);
  if (!hostel) notFound();

  const totalBeds = hostel.units.reduce((sum, u) => sum + (u.bed_capacity || 0), 0);
  const facts = [{ label: t("units"), value: String(hostel.units.length) }];
  if (totalBeds > 0) facts.push({ label: t("beds"), value: String(totalBeds) });

  return (
    <AssetDetailView
      backHref="/student-hostels"
      backLabel={t("backToHostels")}
      title={t("hostelIn", { quarter: hostel.quarter_name })}
      shareTitle="student hostel"
      location={hostel.quarter_name}
      photos={hostel.photos}
      listerRole={hostel.lister_role}
      ownerId={hostel.owner}
      ownerName={hostel.owner_name}
      description={hostel.description}
      amenities={hostel.amenities}
      facts={facts}
      sectionTitle={t("hostelUnits")}
      rows={hostel.units.map((u) => ({
        primary: `${u.room_code} · ${u.unit_type.replace(/_/g, " ").toLowerCase()}`,
        secondary: [u.occupancy_model, u.amenity_tier].filter(Boolean).map((v) => v.replace(/_/g, " ").toLowerCase()).join(" · "),
        right: u.bed_capacity ? `${u.bed_capacity} ${t("beds")}` : undefined,
      }))}
      latitude={hostel.latitude}
      longitude={hostel.longitude}
      sharePath={`/student-hostels/${hostel.id}`}
      mediaEndpoint="student-hostels"
      assetId={hostel.id}
    />
  );
}

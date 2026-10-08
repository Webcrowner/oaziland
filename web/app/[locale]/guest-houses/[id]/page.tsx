import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getGuestHouse } from "@/lib/api";
import AssetDetailView from "@/components/AssetDetailView";

export default async function GuestHouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("AssetDetail");
  const guestHouse = await getGuestHouse(id).catch(() => null);
  if (!guestHouse) notFound();

  const facts = [{ label: t("finish"), value: guestHouse.finish_level ? guestHouse.finish_level.toLowerCase() : "-" }];
  if (guestHouse.is_coastal_leisure) facts.push({ label: t("coastal"), value: "✓" });

  return (
    <AssetDetailView
      backHref="/guest-houses"
      backLabel={t("backToGuestHouses")}
      title={t("guestHouseIn", { quarter: guestHouse.quarter_name })}
      shareTitle="guest house"
      location={guestHouse.quarter_name}
      photos={guestHouse.photos}
      listerRole={guestHouse.lister_role}
      ownerId={guestHouse.owner}
      ownerName={guestHouse.owner_name}
      description={guestHouse.description}
      amenities={guestHouse.amenities}
      facts={facts}
      latitude={guestHouse.latitude}
      longitude={guestHouse.longitude}
      sharePath={`/guest-houses/${guestHouse.id}`}
      mediaEndpoint="guest-houses"
      assetId={guestHouse.id}
    />
  );
}

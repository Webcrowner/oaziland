import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  getMarketplaceListing,
  type MarketplaceCategory, type WarehouseListing, type StoreListing, type BusinessListing, type CarListing,
} from "@/lib/api";
import AssetDetailView from "@/components/AssetDetailView";

const CATEGORIES: MarketplaceCategory[] = ["warehouses", "stores", "businesses", "cars"];
const SHARE_TITLES: Record<MarketplaceCategory, string> = { warehouses: "warehouse", stores: "store", businesses: "business", cars: "car" };
const BACK_KEYS: Record<MarketplaceCategory, string> = {
  warehouses: "backToWarehouses", stores: "backToStores", businesses: "backToBusinesses", cars: "backToCars",
};
const PRICE_BASIS_KEYS: Record<string, string> = {
  SALE: "forSale", RENT_NIGHTLY: "rentNight", RENT_WEEKLY: "rentWeek", RENT_MONTHLY: "rentMonth", RENT_ANNUAL: "rentYear", PER_TRIP: "perTrip",
};

type AnyListing = WarehouseListing & Partial<StoreListing> & Partial<BusinessListing> & Partial<CarListing>;

export default async function MarketplaceDetailPage({ params }: { params: Promise<{ category: string; id: string }> }) {
  const { category, id } = await params;
  if (!CATEGORIES.includes(category as MarketplaceCategory)) notFound();
  const cat = category as MarketplaceCategory;

  const t = await getTranslations("AssetDetail");
  const listing = await getMarketplaceListing<AnyListing>(cat, id).catch(() => null);
  if (!listing) notFound();

  const facts: { label: string; value: string }[] = [];
  if (listing.size_sqm) facts.push({ label: "m²", value: String(listing.size_sqm) });
  if (listing.frontage_meters) facts.push({ label: t("frontage"), value: `${listing.frontage_meters} m` });
  if (listing.seating_capacity) facts.push({ label: t("seats"), value: String(listing.seating_capacity) });
  if (listing.vehicle_spec) {
    const v = listing.vehicle_spec;
    facts.push({ label: `${v.make} ${v.model}`, value: String(v.year) });
    if (v.mileage_km) facts.push({ label: "km", value: v.mileage_km.toLocaleString() });
    if (v.engine_size_cc) facts.push({ label: "cc", value: String(v.engine_size_cc) });
  }

  const extras: string[] = [];
  if (listing.includes_goodwill) extras.push(t("includesGoodwill"));
  if (listing.includes_inventory) extras.push(t("includesInventory"));
  if (listing.annual_revenue_xaf) extras.push(`${t("annualRevenue")}: ${Number(listing.annual_revenue_xaf).toLocaleString()} XAF`);

  const price = Number(listing.price_xaf).toLocaleString();
  const basisKey = PRICE_BASIS_KEYS[listing.price_basis];
  const media = listing.media.map((m) => ({ id: m.id, url: m.file_url, media_type: m.media_type, is_primary: m.order === 0 }));

  return (
    <AssetDetailView
      backHref={`/marketplace/${cat}`}
      backLabel={t(BACK_KEYS[cat])}
      title={listing.title}
      shareTitle={SHARE_TITLES[cat]}
      location={listing.quarter_name ?? ""}
      photos={media}
      listerRole={listing.lister_role}
      isSale={listing.price_basis === "SALE"}
      ownerId={listing.lister_user}
      ownerName={listing.lister_name}
      description={listing.description}
      amenities={extras}
      facts={facts}
      priceText={`${price} XAF${basisKey ? ` · ${t(basisKey)}` : ""}`}
      latitude={listing.latitude}
      longitude={listing.longitude}
      sharePath={`/marketplace/${cat}/${listing.id}`}
      sharePrice={price}
      mediaEndpoint={cat}
      assetId={listing.id}
    />
  );
}

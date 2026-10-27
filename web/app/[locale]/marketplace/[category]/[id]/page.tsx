import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import {
  getMarketplaceListing, getListingConditions, MARKETPLACE_CONDITION_TARGETS,
  type MarketplaceCategory, type WarehouseListing, type StoreListing, type BusinessListing, type CarListing, type GoodsListing,
} from "@/lib/api";
import AssetDetailView from "@/components/AssetDetailView";
import MarketplaceBuyBox from "@/components/MarketplaceBuyBox";
import FavoriteButton from "@/components/FavoriteButton";
import ReportListingButton from "@/components/ReportListingButton";

const CATEGORIES: MarketplaceCategory[] = ["warehouses", "stores", "businesses", "cars", "goods"];
const SHARE_TITLES: Record<MarketplaceCategory, string> = { warehouses: "warehouse", stores: "store", businesses: "business", cars: "car", goods: "item" };
const BACK_KEYS: Record<MarketplaceCategory, string> = {
  warehouses: "backToWarehouses", stores: "backToStores", businesses: "backToBusinesses", cars: "backToCars", goods: "backToGoods",
};
const PRICE_BASIS_KEYS: Record<string, string> = {
  SALE: "forSale", RENT_NIGHTLY: "rentNight", RENT_WEEKLY: "rentWeek", RENT_MONTHLY: "rentMonth", RENT_ANNUAL: "rentYear", PER_TRIP: "perTrip",
};

type AnyListing = WarehouseListing & Partial<StoreListing> & Partial<BusinessListing> & Partial<CarListing> & Partial<GoodsListing>;
const getListing = cache((category: MarketplaceCategory, id: string) => getMarketplaceListing<AnyListing>(category, id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string; id: string }>;
}): Promise<Metadata> {
  const { locale, category, id } = await params;
  if (!CATEGORIES.includes(category as MarketplaceCategory)) return {};
  const listing = await getListing(category as MarketplaceCategory, id).catch(() => null);
  if (!listing) return {};

  const price = `${Number(listing.price_xaf).toLocaleString(locale)} XAF`;
  const description = listing.description.trim() || `${listing.title} · ${price}${listing.quarter_name ? ` · ${listing.quarter_name}` : ""}`;
  const images = listing.media.filter((item) => item.media_type === "PHOTO").map((item) => item.file_url);
  return {
    title: `${listing.title} — ${price} | Oaziland`,
    description,
    openGraph: {
      type: "website",
      title: listing.title,
      description,
      images,
    },
  };
}

export default async function MarketplaceDetailPage({
  params, searchParams,
}: {
  params: Promise<{ locale: string; category: string; id: string }>;
  searchParams: Promise<{ mediaFailed?: string }>;
}) {
  const { category, id } = await params;
  const mediaFailed = Number((await searchParams).mediaFailed) || 0;
  if (!CATEGORIES.includes(category as MarketplaceCategory)) notFound();
  const cat = category as MarketplaceCategory;

  const t = await getTranslations("AssetDetail");
  const tg = await getTranslations("MarketplaceGoods");
  const listing = await getListing(cat, id).catch(() => null);
  if (!listing) notFound();
  const conditionItems = await getListingConditions(MARKETPLACE_CONDITION_TARGETS[cat], id).catch(() => []);
  const conditionRows: { primary: string; secondary?: string }[] = [];
  for (const item of conditionItems) {
    const c = item.structured_conditions;
    if (typeof c.min_lease_months === "number") conditionRows.push({ primary: t("condMinLease", { count: c.min_lease_months }) });
    if (typeof c.mileage_cap_km === "number") conditionRows.push({ primary: t("condMileageCap", { count: c.mileage_cap_km.toLocaleString() }) });
    if (c.deposit_required === true) conditionRows.push({ primary: t("condDeposit") });
    if (c.insurance_required === true) conditionRows.push({ primary: t("condInsurance") });
    if (c.driver_required === true) conditionRows.push({ primary: t("condDriver") });
    if (c.no_subletting === true) conditionRows.push({ primary: t("condNoSubletting") });
    if (c.viewing_appointment_only === true) conditionRows.push({ primary: t("condViewingOnly") });
    if (item.free_text_clause) conditionRows.push({ primary: t("condClause"), secondary: item.free_text_clause });
  }

  const facts: { label: string; value: string }[] = [];
  if (listing.item_category) facts.push({ label: t("itemCategory"), value: tg(`cat_${listing.item_category}`) });
  if (listing.condition) facts.push({ label: t("itemCondition"), value: tg(`cond_${listing.condition}`) });
  if (cat === "goods" && listing.quantity && listing.quantity > 1) facts.push({ label: t("quantityAvailable"), value: String(listing.quantity) });
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
  const depositValue = Number(listing.security_deposit_xaf ?? 0);
  // The buyer is charged the price plus any refundable rental deposit in a single payment.
  const payTotal = (Number(listing.price_xaf) + depositValue).toLocaleString();
  if (depositValue > 0) conditionRows.unshift({ primary: t("condSecurityDeposit", { amount: depositValue.toLocaleString() }), secondary: t("condSecurityDepositNote") });
  const basisKey = PRICE_BASIS_KEYS[listing.price_basis];
  const statusNote = listing.availability_status === "UNDER_OFFER" ? t("listingUnderOffer") : listing.availability_status === "UNAVAILABLE" ? t("listingUnavailable") : "";
  const media = listing.media.map((m) => ({ id: m.id, url: m.file_url, media_type: m.media_type, is_primary: m.order === 0 }));
  const structuredData = {
    "@context": "https://schema.org",
    "@type": cat === "cars" ? "Vehicle" : "Product",
    name: listing.title,
    description: listing.description || undefined,
    image: listing.media.filter((item) => item.media_type === "PHOTO").map((item) => item.file_url),
    offers: {
      "@type": "Offer",
      priceCurrency: "XAF",
      price: listing.price_xaf,
      availability: listing.availability_status === "AVAILABLE"
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };

  return (
    <>
      {mediaFailed > 0 && (
        <p role="alert" className="mx-auto mt-4 max-w-6xl rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t("mediaFailed", { count: mediaFailed })}
        </p>
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
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
        sectionTitle={t("conditions")}
        rows={conditionRows}
        priceText={`${price} XAF${basisKey ? ` · ${t(basisKey)}` : ""}${statusNote ? ` · ${statusNote}` : ""}`}
        latitude={listing.latitude}
        longitude={listing.longitude}
        sharePath={`/marketplace/${cat}/${listing.id}`}
        sharePrice={price}
        mediaEndpoint={cat}
        assetId={listing.id}
        actionSlot={
          <div className="flex flex-col gap-3">
            <MarketplaceBuyBox
              category={cat}
              listingId={listing.id}
              ownerId={listing.lister_user}
              availability={listing.availability_status}
              isSale={listing.price_basis === "SALE"}
              amount={payTotal}
            />
            <FavoriteButton listingId={listing.id} variant="detail" />
            <ReportListingButton listingId={listing.id} />
          </div>
        }
      />
    </>
  );
}

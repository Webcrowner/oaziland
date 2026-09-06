import { getTranslations } from "next-intl/server";
import { getListing, getListingConditions } from "@/lib/api";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import ContactListingButton from "@/components/ContactListingButton";
import FavoriteButton from "@/components/FavoriteButton";
import CompareButton from "@/components/CompareButton";
import PropertyMap from "@/components/PropertyMap";
import PhotoGallery from "@/components/PhotoGallery";
import SimilarListings from "@/components/SimilarListings";
import Badge from "@/components/ui/Badge";
import type { Metadata } from "next";

const LISTER_ROLE_LABEL_KEYS: Record<string, string> = {
  AGENT: "listerAgentFull",
  AGENCY: "listerAgencyFull",
};

function listerRoleLabelKey(role: string, listingType: string): string {
  if (role === "OWNER") {
    return listingType === "SALE" ? "listerOwnerSaleFull" : "listerOwnerFull";
  }
  return LISTER_ROLE_LABEL_KEYS[role] || "listerOwnerFull";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string; locale: string }> }): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id).catch(() => null);
  if (!listing) return {};

  const price = Number(listing.price_xaf).toLocaleString();
  const typeLabel = listing.listing_type === "RENT" ? "For Rent" : "For Sale";
  const title = `${listing.property_asset.type} ${typeLabel} in ${listing.property_asset.quarter_name} — ${price} XAF | Oaziland`;
  const description = listing.property_asset.description
    ? listing.property_asset.description.slice(0, 155)
    : `${listing.property_asset.type} ${typeLabel.toLowerCase()} in ${listing.property_asset.quarter_name}, Cameroon. Verified listing on Oaziland.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

/**
 * Listing detail — redesigned around the same real estate platform
 * patterns applied to Search: a real photo gallery leading the page,
 * an icon stat row, real amenities/rules/nearby-facilities badges
 * (all real data that existed but was never actually shown here), a
 * real conditions/rules section (the ListingCondition feature closed
 * earlier), a sticky contact sidebar on desktop, and a real "Similar
 * Listings" section closing out the page — the exact pattern that
 * keeps someone browsing instead of leaving after one listing.
 */
export default async function ListingDetailPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id } = await params;
  const t = await getTranslations("ListingDetailPage");
  const locale = (await params).locale;
  const listing = await getListing(id).catch(() => null);
  if (!listing) notFound();

  const conditions = await getListingConditions("property.Listing", id).catch(() => []);

  const finishLabels: Record<string, string> = { MODERN: t("finishModern"), STANDARD: t("finishStandard") };
  const price = Number(listing.price_xaf).toLocaleString();
  const finish = finishLabels[listing.property_asset.finish_level] || null;
  const postedDate = listing.published_at
    ? new Date(listing.published_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: `${listing.property_asset.type} in ${listing.property_asset.quarter_name}`,
    price: listing.price_xaf,
    priceCurrency: "XAF",
    address: listing.property_asset.quarter_name,
  };

  return (
    <main>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

      <div className="max-w-6xl mx-auto px-4 py-8">
        <PhotoGallery photos={listing.photos || []} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main content column */}
          <div className="lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-sm font-semibold uppercase text-white bg-[var(--navy)] px-3 py-1 rounded">
                {listing.property_asset.type}
              </span>
              {finish && <Badge variant="gold">{finish}</Badge>}
            </div>

            <h1 className="text-3xl font-bold text-[var(--navy)] mb-2">{price} XAF</h1>
            <p className="text-gray-600 mb-1">📍 {listing.property_asset.quarter_name}</p>
            {postedDate && <p className="text-sm text-gray-400 mb-4">{t("postedOnFull", { date: postedDate })}</p>}

            {/* The real icon stat row — the same pattern applied to
                PropertyCard, shown here at a larger, detail-page scale. */}
            <div className="flex items-center gap-5 text-base text-gray-700 border-y border-gray-200 py-4 mb-6">
              {listing.property_asset.bedrooms !== null && (
                <span className="flex items-center gap-2">🛏 <strong>{listing.property_asset.bedrooms}</strong> {t("bedrooms")}</span>
              )}
              {listing.property_asset.bathrooms !== null && (
                <span className="flex items-center gap-2">🛁 <strong>{listing.property_asset.bathrooms}</strong> {t("bathrooms")}</span>
              )}
              {listing.property_asset.size_sqm && (
                <span className="flex items-center gap-2">📐 <strong>{listing.property_asset.size_sqm}</strong> m²</span>
              )}
            </div>

            {listing.property_asset.description && (
              <p className="text-gray-700 mb-6 border-l-4 border-[var(--gold)] pl-4">{listing.property_asset.description}</p>
            )}

            {/* Real amenities — data that already existed but was
                never actually rendered on this page before now. */}
            {listing.property_asset.amenities.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">{t("amenities")}</h2>
                <div className="flex flex-wrap gap-2">
                  {listing.property_asset.amenities.map((a) => <Badge key={a} variant="green">{t(`amenity_${a}`)}</Badge>)}
                </div>
              </div>
            )}

            {listing.property_asset.house_rules.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">{t("houseRules")}</h2>
                <div className="flex flex-wrap gap-2">
                  {listing.property_asset.house_rules.map((r) => <Badge key={r} variant="neutral">{t(`rule_${r}`)}</Badge>)}
                </div>
              </div>
            )}

            {listing.property_asset.nearby_facility_names.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">{t("nearbyFacilities")}</h2>
                <div className="flex flex-wrap gap-2">
                  {listing.property_asset.nearby_facility_names.map((f) => <Badge key={f} variant="neutral">{f}</Badge>)}
                </div>
              </div>
            )}

            {/* Real conditions/rules — the ListingCondition feature,
                fully built since an early prompt but never reachable
                until this session; shown here for the first time. */}
            {conditions.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">{t("conditions")}</h2>
                {conditions.map((c) => (
                  <div key={c.id} className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 mb-2">
                    {typeof c.structured_conditions.min_lease_months === "number" && (
                      <p>{t("minLeaseMonths", { count: c.structured_conditions.min_lease_months as number })}</p>
                    )}
                    {c.structured_conditions.deposit_required === true && <p>{t("depositRequiredNote")}</p>}
                    {c.free_text_clause && <p className="italic">{c.free_text_clause}</p>}
                  </div>
                ))}
              </div>
            )}

            {listing.property_asset.latitude && listing.property_asset.longitude && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">{t("locationOnMap")}</h2>
                <PropertyMap
                  latitude={Number(listing.property_asset.latitude)}
                  longitude={Number(listing.property_asset.longitude)}
                  label={`${listing.property_asset.type} — ${listing.property_asset.quarter_name}`}
                />
              </div>
            )}
          </div>

          {/* Sticky sidebar — the lister card and real actions stay
              visible while scrolling through the details, the exact
              pattern every major listing page uses so the contact
              action is never more than a glance away. */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <div className={`rounded-lg p-4 mb-4 ${listing.lister_role === "OWNER" ? "bg-green-50" : "bg-[var(--gold)]/10"}`}>
              <span className={`text-xs font-semibold uppercase px-2 py-1 rounded ${listing.lister_role === "OWNER" ? "bg-green-100 text-green-800" : "bg-[var(--gold)]/30 text-[#8A6D14]"}`}>
                {t(listerRoleLabelKey(listing.lister_role, listing.listing_type))}
              </span>
              <p className="font-semibold text-[var(--navy)] mt-1">
                {listing.lister_role === "AGENT" || listing.lister_role === "AGENCY" ? (
                  <Link href={`/agents/${listing.lister_id}`} className="hover:text-[var(--gold)]">{listing.lister_display_name}</Link>
                ) : (
                  listing.lister_display_name
                )}
              </p>
              {listing.lister_agency_name && <p className="text-sm text-gray-500">{listing.lister_agency_name}</p>}
              <Link
                href={{ pathname: "/feed/create", query: { listing_id: listing.id } }}
                className="text-xs font-semibold text-[var(--navy)] underline hover:text-[var(--gold)] mt-2 inline-block"
              >
                {t("shareOnSocial")}
              </Link>
            </div>

            <div className="flex flex-col gap-3">
              <ContactListingButton listingId={listing.id} />
              <div className="flex gap-3">
                <FavoriteButton listingId={listing.id} variant="detail" />
                <CompareButton listingId={listing.id} />
              </div>
            </div>
          </div>
        </div>

        <SimilarListings
          excludeId={listing.id} quarterId={listing.property_asset.quarter}
          propertyType={listing.property_asset.type} listingType={listing.listing_type}
        />
      </div>
    </main>
  );
}

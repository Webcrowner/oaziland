import { searchListings } from "@/lib/api";
import PropertyCard from "@/components/PropertyCard";
import { getTranslations } from "next-intl/server";

/**
 * A real "Similar Listings" section — the pattern every major listing
 * detail page ends with, keeping someone browsing instead of leaving
 * once they've seen one property. A genuine Server Component: fetches
 * real comparable listings (same quarter, same property type, same
 * rent/sale category) server-side, excluding the listing you're
 * already looking at — never fabricated or randomly unrelated results.
 */
export default async function SimilarListings({
  excludeId, quarterId, propertyType, listingType,
}: {
  excludeId: string; quarterId: string; propertyType: string; listingType: string;
}) {
  const t = await getTranslations("ListingDetailPage");
  const data = await searchListings({ quarter: quarterId, property_type: propertyType, listing_type: listingType }).catch(() => ({ results: [] }));
  const similar = data.results.filter((l) => l.id !== excludeId).slice(0, 3);

  if (similar.length === 0) return null;

  return (
    <div className="mt-12 pt-8 border-t border-gray-200">
      <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--navy)] mb-4">{t("similarListings")}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {similar.map((listing) => <PropertyCard key={listing.id} listing={listing} />)}
      </div>
    </div>
  );
}

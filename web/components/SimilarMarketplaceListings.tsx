import { getTranslations } from "next-intl/server";
import { getSimilarListings, type MarketplaceCategory } from "@/lib/api";
import MarketplaceListingCard from "@/components/MarketplaceListingCard";

/** "Similar items" under a marketplace listing (same category and kind, nearby first), like Jiji or Leboncoin. */
export default async function SimilarMarketplaceListings({ category, id }: { category: MarketplaceCategory; id: string }) {
  const t = await getTranslations("MarketplacePage");
  const rows = await getSimilarListings(category, id).catch(() => []);
  if (rows.length === 0) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 pb-10">
      <h2 className="mb-3 text-xl font-bold text-[var(--navy)]">{category === "cars" ? t("similarCars") : t("similarItems")}</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {rows.map((listing) => <MarketplaceListingCard key={listing.id} listing={{ ...listing, category }} />)}
      </div>
    </section>
  );
}

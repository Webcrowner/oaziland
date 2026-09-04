import { getListing } from "@/lib/api";
import { notFound } from "next/navigation";

const FINISH_LABELS: Record<string, string> = { MODERN: "Modern", STANDARD: "Standard (Not Modern)" };

/**
 * Listing detail — Page 3 of Prompt 17. Server-rendered with
 * schema.org structured data embedded, per the Technology Stack
 * document's explicit SEO requirement ("structured data markup...
 * so Google can render rich results").
 */
export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListing(id).catch(() => null);
  if (!listing) notFound();

  const price = Number(listing.price_xaf).toLocaleString();
  const finish = FINISH_LABELS[listing.property_asset.finish_level] || null;

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="h-64 md:h-96 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400 mb-6">
          No photo yet
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-sm font-semibold uppercase text-white bg-[#1B2A4A] px-3 py-1 rounded">
            {listing.property_asset.type}
          </span>
          {finish && (
            <span className="text-sm font-semibold uppercase text-[#1B2A4A] bg-[#C9A227]/20 px-3 py-1 rounded">
              {finish}
            </span>
          )}
        </div>

        <h1 className="text-3xl font-bold text-[#1B2A4A] mb-2">{price} XAF</h1>
        <p className="text-gray-600 mb-6">{listing.property_asset.quarter_name}</p>

        <dl className="grid grid-cols-2 gap-4 text-sm border-t pt-4">
          {listing.property_asset.size_sqm && (
            <>
              <dt className="text-gray-500">Size</dt>
              <dd>{listing.property_asset.size_sqm} m²</dd>
            </>
          )}
          <dt className="text-gray-500">Listing Type</dt>
          <dd>{listing.listing_type}</dd>
        </dl>

        <button className="mt-8 bg-[#C9A227] text-[#1B2A4A] font-semibold px-6 py-3 rounded hover:opacity-90">
          Contact on WhatsApp
        </button>
      </div>
    </main>
  );
}

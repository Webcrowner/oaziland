import Link from "next/link";
import type { Listing } from "@/lib/api";

const FINISH_LABELS: Record<string, string> = {
  MODERN: "Modern",
  STANDARD: "Standard",
};

export default function PropertyCard({ listing }: { listing: Listing }) {
  const price = Number(listing.price_xaf).toLocaleString();
  const finish = FINISH_LABELS[listing.property_asset.finish_level] || null;

  return (
    <Link
      href={`/listing/${listing.id}`}
      className="block border rounded-lg overflow-hidden hover:shadow-lg transition-shadow bg-white"
    >
      <div className="h-40 bg-gray-200 flex items-center justify-center text-gray-400 text-sm">
        No photo yet
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold uppercase text-[#1B2A4A] bg-gray-100 px-2 py-1 rounded">
            {listing.property_asset.type}
          </span>
          {finish && (
            <span className="text-xs font-semibold uppercase text-[#C9A227] bg-[#1B2A4A]/5 px-2 py-1 rounded">
              {finish}
            </span>
          )}
        </div>
        <p className="text-lg font-bold text-[#1B2A4A]">{price} XAF</p>
        <p className="text-sm text-gray-600">{listing.property_asset.quarter_name}</p>
      </div>
    </Link>
  );
}

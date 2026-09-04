import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Listing } from "@/lib/api";

export default function PropertyCard({ listing }: { listing: Listing }) {
  const t = useTranslations("PropertyCard");
  const finishLabels: Record<string, string> = { MODERN: t("finishModern"), STANDARD: t("finishStandard") };

  const price = Number(listing.price_xaf).toLocaleString();
  const finish = finishLabels[listing.property_asset.finish_level] || null;

  return (
    <Link
      href={`/listing/${listing.id}`}
      className="block border rounded-lg overflow-hidden bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-1"
    >
      <div className="h-40 bg-gray-200 flex items-center justify-center text-gray-600 text-sm">
        {t("noPhotoYet")}
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold uppercase text-[#1B2A4A] bg-gray-100 px-2 py-1 rounded">
            {listing.property_asset.type}
          </span>
          {finish && (
            <span className="text-xs font-semibold uppercase text-white bg-[#1B2A4A] px-2 py-1 rounded">
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

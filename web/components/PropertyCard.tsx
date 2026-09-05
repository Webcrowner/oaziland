import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Listing } from "@/lib/api";

const LISTER_ROLE_LABEL_KEYS: Record<string, string> = {
  OWNER: "listerOwner",
  AGENT: "listerAgent",
  AGENCY: "listerAgency",
};

/**
 * PropertyCard — search result card. WHY the lister-role badge and
 * posted date are here, not just on the detail page: per the
 * founder's explicit requirement, a viewer should be able to tell
 * AT A GLANCE, while scanning search results, whether a listing is
 * from the owner directly or an agent/agency — some people have a
 * real preference and shouldn't have to open every listing to find out.
 */
export default function PropertyCard({ listing }: { listing: Listing }) {
  const t = useTranslations("PropertyCard");
  const locale = useLocale();
  const finishLabels: Record<string, string> = { MODERN: t("finishModern"), STANDARD: t("finishStandard") };

  const price = Number(listing.price_xaf).toLocaleString();
  const finish = finishLabels[listing.property_asset.finish_level] || null;
  const postedDate = listing.published_at
    ? new Date(listing.published_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <Link
      href={`/listing/${listing.id}`}
      className="block border rounded-lg overflow-hidden bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-1"
    >
      <div className="h-40 bg-gray-200 flex items-center justify-center text-gray-600 text-sm">
        {t("noPhotoYet")}
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs font-semibold uppercase text-[#1B2A4A] bg-gray-100 px-2 py-1 rounded">
            {listing.property_asset.type}
          </span>
          {finish && (
            <span className="text-xs font-semibold uppercase text-white bg-[#1B2A4A] px-2 py-1 rounded">
              {finish}
            </span>
          )}
          {/* The lister-role badge — a distinct color per role so it's
              scannable across a whole grid of results, not just readable
              one card at a time. */}
          <span
            className={`text-xs font-semibold uppercase px-2 py-1 rounded ${
              listing.lister_role === "OWNER" ? "bg-green-100 text-green-800" : "bg-[#C9A227]/20 text-[#8A6D14]"
            }`}
          >
            {t(LISTER_ROLE_LABEL_KEYS[listing.lister_role] || "listerOwner")}
          </span>
        </div>
        <p className="text-lg font-bold text-[#1B2A4A]">{price} XAF</p>
        <p className="text-sm text-gray-600 mb-1">{listing.property_asset.quarter_name}</p>
        {listing.property_asset.description && (
          <p className="text-xs text-gray-500 line-clamp-2 mb-1">{listing.property_asset.description}</p>
        )}
        {postedDate && <p className="text-xs text-gray-400">{t("postedOn", { date: postedDate })}</p>}
      </div>
    </Link>
  );
}

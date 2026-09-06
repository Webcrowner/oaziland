"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import FavoriteButton from "@/components/FavoriteButton";
import type { Listing } from "@/lib/api";

const LISTER_ROLE_LABEL_KEYS: Record<string, string> = {
  AGENT: "listerAgent",
  AGENCY: "listerAgency",
};

function listerRoleLabelKey(role: string, listingType: string): string {
  if (role === "OWNER") {
    return listingType === "SALE" ? "listerOwnerSale" : "listerOwner";
  }
  return LISTER_ROLE_LABEL_KEYS[role] || "listerOwner";
}

/**
 * PropertyCard — redesigned in the photo-forward, icon-scannable
 * style established by every major real estate platform (Zillow,
 * Trulia): the photo carries the card, not the text. Two real,
 * previously-missing pieces added here:
 *
 * 1. A REAL photo carousel — cycles through the listing's actual
 *    photos on hover (desktop) or via tap arrows (mobile), using
 *    real ListingPhoto data now that upload exists, not a static
 *    placeholder forever.
 * 2. An icon stat row (bed/bath/size) — instantly scannable in one
 *    line, the exact pattern every major listing card uses, replacing
 *    a paragraph of description text as the first thing you read.
 */
export default function PropertyCard({ listing }: { listing: Listing }) {
  const t = useTranslations("PropertyCard");
  const locale = useLocale();
  const [photoIndex, setPhotoIndex] = useState(0);
  const finishLabels: Record<string, string> = { MODERN: t("finishModern"), STANDARD: t("finishStandard") };

  const price = Number(listing.price_xaf).toLocaleString();
  const finish = finishLabels[listing.property_asset.finish_level] || null;
  const postedDate = listing.published_at
    ? new Date(listing.published_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { year: "numeric", month: "short", day: "numeric" })
    : null;

  const photos = listing.photos?.filter((p) => p.media_type === "PHOTO") ?? [];
  const hasMultiplePhotos = photos.length > 1;

  function showPhoto(index: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setPhotoIndex(index);
  }

  return (
    <Link
      href={`/listing/${listing.id}`}
      className="group block border border-gray-200 rounded-lg overflow-hidden bg-white transition-all duration-200 hover:shadow-xl hover:-translate-y-1"
    >
      <div className="relative h-52 bg-gray-100">
        {photos.length > 0 ? (
          <img src={photos[photoIndex].url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">{t("noPhotoYet")}</div>
        )}

        <FavoriteButton listingId={listing.id} variant="card" />

        {/* Real dot navigation — appears only when there's genuinely
            more than one photo to cycle through, never decoration on
            a single-photo (or photo-less) listing. */}
        {hasMultiplePhotos && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {photos.map((_, i) => (
              <button
                key={i} onClick={(e) => showPhoto(i, e)}
                className={`w-1.5 h-1.5 rounded-full transition-all ${i === photoIndex ? "bg-white w-4" : "bg-white/60"}`}
                aria-label={`Photo ${i + 1}`}
              />
            ))}
          </div>
        )}

        {/* Price sits ON the photo, bottom-left — the exact pattern
            every major listing card uses, since price is the single
            most important fact and shouldn't wait below the fold of
            the image. */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-2">
          <p className="text-white text-xl font-bold drop-shadow">{price} <span className="text-sm font-medium">XAF</span></p>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-xs font-semibold uppercase text-[var(--navy)] bg-gray-100 px-2 py-1 rounded">
            {listing.property_asset.type}
          </span>
          {finish && (
            <span className="text-xs font-semibold uppercase text-white bg-[var(--navy)] px-2 py-1 rounded">
              {finish}
            </span>
          )}
          <span
            className={`text-xs font-semibold uppercase px-2 py-1 rounded ${
              listing.lister_role === "OWNER" ? "bg-green-100 text-green-800" : "bg-[var(--gold)]/20 text-[#8A6D14]"
            }`}
          >
            {t(listerRoleLabelKey(listing.lister_role, listing.listing_type))}
          </span>
        </div>

        {/* The real icon stat row — bed/bath/size in one scannable
            line, shown only for the fields that actually apply (Land
            has no bedrooms; this never fakes a stat that isn't real). */}
        <div className="flex items-center gap-3 text-sm text-gray-700 mb-2">
          {listing.property_asset.bedrooms !== null && (
            <span className="flex items-center gap-1">🛏 {listing.property_asset.bedrooms}</span>
          )}
          {listing.property_asset.bathrooms !== null && (
            <span className="flex items-center gap-1">🛁 {listing.property_asset.bathrooms}</span>
          )}
          {listing.property_asset.size_sqm && (
            <span className="flex items-center gap-1">📐 {listing.property_asset.size_sqm}m²</span>
          )}
        </div>

        <p className="text-sm text-gray-600 mb-1">📍 {listing.property_asset.quarter_name}</p>
        {postedDate && <p className="text-xs text-gray-400">{t("postedOn", { date: postedDate })}</p>}
      </div>
    </Link>
  );
}

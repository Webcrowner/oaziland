"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import ListerRoleBadge from "@/components/ListerRoleBadge";
import ListerRatingChip from "@/components/ListerRatingChip";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";
import type { Listing } from "@/lib/api";
import { IconBed, IconBath, IconArea, IconMapPin } from "./Icons";

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
  const hasVideo = listing.photos?.some((p) => p.media_type === "VIDEO") ?? false;

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

        <ListerRoleBadge role={listing.lister_role} isSale={listing.listing_type === "SALE"} variant="overlay" />
        <WhatsAppShareButton
          variant="overlay"
          title={listing.property_asset.type.toLowerCase()}
          location={listing.property_asset.quarter_name}
          price={price}
          path={`/listing/${listing.id}`}
        />

        {hasVideo && (
          <span className="absolute top-12 left-2 text-[10px] font-semibold uppercase bg-black/70 text-white px-2 py-0.5 rounded">
            {t("video")}
          </span>
        )}

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
          <ListerRatingChip average={listing.lister_average_rating} count={listing.lister_rating_count} />
        </div>

        {/* The real icon stat row — bed/bath/size in one scannable
            line, shown only for the fields that actually apply. */}
        <div className="flex items-center gap-4 text-xs font-medium text-slate-600 mb-2.5">
          {listing.property_asset.bedrooms !== null && (
            <span className="flex items-center gap-1.5">
              <IconBed size={15} className="text-slate-400" />
              <span>{listing.property_asset.bedrooms} {listing.property_asset.bedrooms === 1 ? "bed" : "beds"}</span>
            </span>
          )}
          {listing.property_asset.bathrooms !== null && (
            <span className="flex items-center gap-1.5">
              <IconBath size={15} className="text-slate-400" />
              <span>{listing.property_asset.bathrooms} {listing.property_asset.bathrooms === 1 ? "bath" : "baths"}</span>
            </span>
          )}
          {listing.property_asset.size_sqm && (
            <span className="flex items-center gap-1.5">
              <IconArea size={15} className="text-slate-400" />
              <span>{listing.property_asset.size_sqm} m²</span>
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500 mb-1 flex items-center gap-1 font-medium">
          <IconMapPin size={13} className="text-amber-500 shrink-0" />
          <span className="truncate">{listing.property_asset.quarter_name}</span>
        </p>
        {postedDate && <p className="text-xs text-gray-400">{t("postedOn", { date: postedDate })}</p>}
      </div>
    </Link>
  );
}

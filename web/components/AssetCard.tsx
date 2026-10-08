"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import ListerRoleBadge from "@/components/ListerRoleBadge";
import ListerRatingChip from "@/components/ListerRatingChip";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";
import { IconMapPin } from "./Icons";

interface AssetCardProps {
  href: string;
  photoUrl?: string | null;
  listerRole?: string;
  listerRating?: number | null;
  listerRatingCount?: number;
  /** Small label under the role badge, e.g. Verified / Pending review. */
  statusBadge?: ReactNode;
  share: { title: string; location: string; price?: string; path: string };
  /** Shown on the photo, bottom-left. Omit when the asset has no price. */
  price?: string;
  priceUnit?: string;
  typeLabel: string;
  location: string;
  mapsHref?: string;
  /** Icon/stat row shown under the chips. */
  details?: ReactNode;
  /** Action area at the bottom of the card. */
  children?: ReactNode;
}

/**
 * The shared browse card for hotels, venues, guest houses and student
 * hostels — the same layout as PropertyCard (photo with role badge,
 * WhatsApp share and price on top; chips, details and location below)
 * so every page looks identical.
 */
export default function AssetCard({
  href,
  photoUrl,
  listerRole,
  listerRating,
  listerRatingCount,
  statusBadge,
  share,
  price,
  priceUnit,
  typeLabel,
  location,
  mapsHref,
  details,
  children,
}: AssetCardProps) {
  const t = useTranslations("PropertyCard");

  return (
    <div className="group block border border-gray-200 rounded-lg overflow-hidden bg-white transition-all duration-200 hover:shadow-xl hover:-translate-y-1">
      <Link href={href} className="block relative h-52 bg-gray-100">
        {photoUrl ? (
          <img src={photoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">{t("noPhotoYet")}</div>
        )}

        <ListerRoleBadge role={listerRole} variant="overlay" />
        <WhatsAppShareButton variant="overlay" {...share} />
        {statusBadge && <div className="absolute top-12 left-2">{statusBadge}</div>}

        {price && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-2">
            <p className="text-white text-xl font-bold drop-shadow">
              {price} <span className="text-sm font-medium">XAF{priceUnit ? ` ${priceUnit}` : ""}</span>
            </p>
          </div>
        )}
      </Link>

      <div className="p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-xs font-semibold uppercase text-[var(--navy)] bg-gray-100 px-2 py-1 rounded">{typeLabel}</span>
          <ListerRatingChip average={listerRating} count={listerRatingCount} />
        </div>

        {details && <div className="flex items-center gap-4 text-xs font-medium text-slate-600 mb-2.5 flex-wrap">{details}</div>}

        <p className="text-xs text-slate-500 mb-1 flex items-center justify-between gap-2 font-medium">
          <span className="flex items-center gap-1 min-w-0">
            <IconMapPin size={13} className="text-amber-500 shrink-0" />
            <span className="truncate">{location}</span>
          </span>
          {mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-bold text-amber-600 hover:text-amber-700 underline shrink-0"
              title="Open Google Maps and follow coordinates"
            >
              Maps ↗
            </a>
          )}
        </p>

        {children && <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">{children}</div>}
      </div>
    </div>
  );
}

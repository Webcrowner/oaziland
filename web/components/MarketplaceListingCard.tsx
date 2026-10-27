"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import FavoriteButton from "@/components/FavoriteButton";
import { IconMapPin } from "@/components/Icons";
import type { FeedItem } from "@/lib/useMarketplaceListings";

const CATEGORY_ICONS: Record<FeedItem["category"], string> = { goods: "🛍️", cars: "🚗", stores: "🏬", warehouses: "🏭", businesses: "💼" };

/** The browse card for any marketplace category: photo, price, title, place and a one-line summary of the item. */
export default function MarketplaceListingCard({ listing }: { listing: FeedItem }) {
  const t = useTranslations("MarketplacePage");
  const tf = useTranslations("MarketplaceFilters");
  const tg = useTranslations("MarketplaceGoods");
  const photo = listing.media.find((m) => m.media_type === "PHOTO");
  const video = listing.media.find((m) => m.media_type === "VIDEO");
  const isSale = listing.price_basis === "SALE";
  const spec = listing.vehicle_spec;

  let summary = "";
  if (spec) summary = [`${spec.make} ${spec.model}`, spec.year, spec.mileage_km ? `${spec.mileage_km.toLocaleString()} km` : ""].filter(Boolean).join(" · ");
  else if (listing.category === "goods" && listing.item_category) summary = tg(`cat_${listing.item_category}`);
  else if (listing.size_sqm) summary = `${Number(listing.size_sqm).toLocaleString()} m²`;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300/60 hover:shadow-lg">
      <div className="relative aspect-[4/3] bg-slate-100">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.file_url} alt={listing.title} loading="lazy" className="h-full w-full object-cover" />
        ) : video ? (
          <video src={video.file_url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl text-slate-300" aria-hidden>{CATEGORY_ICONS[listing.category]}</div>
        )}
        {video && !photo && (
          <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold text-white" aria-hidden>▶</span>
        )}
        <FavoriteButton listingId={listing.id} />
        <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
          {t(listing.category)}
        </span>
        {listing.category === "goods" && listing.condition && (
          <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{tg(`cond_${listing.condition}`)}</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <p className="text-base font-bold text-[var(--navy)] sm:text-lg">
          {Number(listing.price_xaf).toLocaleString()} <span className="text-xs font-semibold text-slate-500">XAF</span>
          {!isSale && <span className="ml-1 text-xs font-medium text-slate-500">{tf(`basis_${listing.price_basis}`)}</span>}
        </p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">
          {/* The stretched link makes the whole card tappable while the favourite button stays on top. */}
          <Link href={`/marketplace/${listing.category}/${listing.id}`} className="after:absolute after:inset-0 after:content-['']">{listing.title}</Link>
        </h3>
        {summary && <p className="truncate text-xs text-slate-500">{summary}</p>}
        {listing.quarter_name && (
          <p className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-slate-500">
            <IconMapPin size={13} className="shrink-0 text-amber-500" />
            <span className="truncate">{listing.quarter_name}</span>
          </p>
        )}
      </div>
    </article>
  );
}

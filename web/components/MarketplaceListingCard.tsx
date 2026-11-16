"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import FavoriteButton from "@/components/FavoriteButton";
import SaleCountdown from "@/components/SaleCountdown";
import { IconMapPin } from "@/components/Icons";
import { discountPercent, isSaleRunning } from "@/lib/flashSale";
import { compareAtDisplay } from "@/lib/comparePrice";
import CompareAtPrice from "@/components/CompareAtPrice";
import type { FeedItem } from "@/lib/useMarketplaceListings";

const CATEGORY_ICONS: Record<FeedItem["category"], string> = { goods: "🛍️", cars: "🚗", stores: "🏬", warehouses: "🏭", businesses: "💼" };

/** The browse card for any marketplace category: photo, price, title, place and a one-line summary of the item. */
export default function MarketplaceListingCard({ listing }: { listing: FeedItem }) {
  const t = useTranslations("MarketplacePage");
  const tf = useTranslations("MarketplaceFilters");
  const tg = useTranslations("MarketplaceGoods");
  const tc = useTranslations("CarListing");
  const tf2 = useTranslations("FlashSale");
  const photo = listing.media.find((m) => m.media_type === "PHOTO");
  const video = listing.media.find((m) => m.media_type === "VIDEO");
  const isSale = listing.price_basis === "SALE";
  const flash = listing.category === "goods" && isSaleRunning(listing);
  const flashPercent = flash ? discountPercent(Number(listing.price_xaf), Number(listing.current_price_xaf ?? listing.price_xaf)) : null;
  const hasVariants = listing.category === "goods" && Boolean(listing.has_variants) && listing.price_from_xaf != null;
  const shownPrice = hasVariants
    ? Number(listing.price_from_xaf)
    : flash ? Number(listing.current_price_xaf ?? listing.sale_price_xaf ?? listing.price_xaf) : Number(listing.price_xaf);
  const compareAt = listing.category === "goods" ? listing.compare_at_price_xaf : null;
  const originalPrice = flash && !hasVariants ? Number(listing.price_xaf) : undefined;
  const hasCompareAt = compareAtDisplay(compareAt, shownPrice, originalPrice) !== null;
  const spec = listing.vehicle_spec;

  let summary = "";
  if (spec) {
    summary = [
      spec.year, spec.mileage_km != null ? `${spec.mileage_km.toLocaleString()} km` : "",
      spec.fuel_type ? tc(`fuel_${spec.fuel_type}`) : "", spec.transmission ? tc(`trans_${spec.transmission}`) : "",
    ].filter(Boolean).join(" · ");
  }
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
        {(listing.is_boosted || flashPercent !== null) && (
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {flashPercent !== null && (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-black tracking-wide text-white">
                {tf2("badge")}{flashPercent > 0 ? ` ${tf2("percentOff", { percent: flashPercent })}` : ""}
              </span>
            )}
            {listing.is_boosted && (
              <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-black tracking-wide text-slate-900">{t("topBadge")}</span>
            )}
          </div>
        )}
        <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
          {t(listing.category)}
        </span>
        {spec?.vehicle_condition && spec.vehicle_condition !== "LOCALLY_USED" && (
          <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{tc(`cond_${spec.vehicle_condition}`)}</span>
        )}
        {listing.category === "goods" && listing.condition && (
          <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{tg(`cond_${listing.condition}`)}</span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-base font-bold text-[var(--navy)] sm:text-lg">
          {hasVariants && <span className="text-xs font-semibold text-slate-500">{tg("priceFrom")}</span>}
          <span>{shownPrice.toLocaleString()} <span className="text-xs font-semibold text-slate-500">XAF</span></span>
          {hasCompareAt ? (
            <CompareAtPrice compareAtXaf={compareAt} shownPrice={shownPrice} originalPrice={originalPrice} compact showUnit={false} />
          ) : (
            flash && !hasVariants && <span className="text-xs font-medium text-slate-400 line-through">{Number(listing.price_xaf).toLocaleString()}</span>
          )}
          {!isSale && <span className="ml-1 text-xs font-medium text-slate-500">{spec ? tc("perDay") : tf(`basis_${listing.price_basis}`)}</span>}
          {isSale && listing.price_negotiable && !flash && <span className="ml-1 text-xs font-medium text-green-700">{tc("negotiable")}</span>}
        </p>
        {flash && listing.sale_ends_at && <SaleCountdown endsAt={listing.sale_ends_at} className="text-xs font-semibold text-red-700" />}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">
          {/* The stretched link makes the whole card tappable while the favourite button stays on top. */}
          <Link href={`/marketplace/${listing.category}/${listing.id}`} className="after:absolute after:inset-0 after:content-['']">{listing.title}</Link>
        </h3>
        {summary && <p className="truncate text-xs text-slate-500">{summary}</p>}
        {(listing.quarter_name || listing.distance_km != null) && (
          <p className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-slate-500">
            <IconMapPin size={13} className="shrink-0 text-amber-500" />
            <span className="truncate">
              {[listing.quarter_name, listing.distance_km != null ? t("kmAway", { km: listing.distance_km }) : ""].filter(Boolean).join(" · ")}
            </span>
          </p>
        )}
      </div>
    </article>
  );
}

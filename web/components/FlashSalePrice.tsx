"use client";
import { useTranslations } from "next-intl";
import { discountPercent, isSaleRunning } from "@/lib/flashSale";
import { compareAtDisplay } from "@/lib/comparePrice";
import SaleCountdown from "@/components/SaleCountdown";
import CompareAtPrice from "@/components/CompareAtPrice";

/** The price line of a goods listing on its detail page: sale badge, current price, struck-through previous price and countdown. */
export default function FlashSalePrice({
  priceXaf, currentPriceXaf, onSale, saleEndsAt, suffix = "", compareAtXaf = null, fromXaf = null,
}: {
  priceXaf: string;
  currentPriceXaf: string;
  onSale: boolean;
  saleEndsAt: string | null;
  suffix?: string;
  /** The seller's display-only "was" price. */
  compareAtXaf?: string | null;
  /** For a listing with options: the cheapest in-stock version, shown as "From X". */
  fromXaf?: string | null;
}) {
  const t = useTranslations("FlashSale");
  const tg = useTranslations("MarketplaceGoods");
  const running = isSaleRunning({ on_sale: onSale, sale_ends_at: saleEndsAt });
  const hasVariants = fromXaf !== null;
  const normal = Number(priceXaf);
  const current = hasVariants ? Number(fromXaf) : Number(running ? currentPriceXaf : priceXaf);
  const percent = discountPercent(normal, current);
  const showSale = running && !hasVariants;
  const hasCompareAt = compareAtDisplay(compareAtXaf, current, showSale ? normal : undefined) !== null;

  return (
    <div className="mb-1">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-2xl font-bold text-[var(--navy)]">
        {hasVariants && <span className="text-base font-semibold text-slate-500">{tg("priceFrom")}</span>}
        <span>{current.toLocaleString()} XAF</span>
        {hasCompareAt ? (
          <CompareAtPrice compareAtXaf={compareAtXaf} shownPrice={current} originalPrice={showSale ? normal : undefined} />
        ) : (
          showSale && percent > 0 && <span className="text-base font-semibold text-slate-400 line-through">{normal.toLocaleString()} XAF</span>
        )}
        {suffix && <span className="text-base font-semibold text-slate-500">{suffix}</span>}
      </p>
      {running && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-black tracking-wide text-white">
            {t("badge")}{percent > 0 && !hasVariants ? ` ${t("percentOff", { percent })}` : ""}
          </span>
          {saleEndsAt && <SaleCountdown endsAt={saleEndsAt} className="font-semibold text-red-700" />}
        </p>
      )}
    </div>
  );
}

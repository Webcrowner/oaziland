"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getMarketplaceListingReviews, type MarketplaceCategory, type MarketplaceReviews as ReviewsData } from "@/lib/api";
import StarRating from "@/components/StarRating";

/** What buyers who completed an order say about this listing; every review is a verified purchase. */
export default function MarketplaceReviews({ category, listingId }: { category: MarketplaceCategory; listingId: string }) {
  const t = useTranslations("MarketplaceReviews");
  const locale = useLocale();
  const [data, setData] = useState<ReviewsData | null>(null);

  useEffect(() => {
    getMarketplaceListingReviews(category, listingId).then(setData).catch(() => {});
  }, [category, listingId]);

  if (!data || data.count === 0) return null;

  return (
    <section className="mx-auto mt-8 max-w-6xl px-4" aria-labelledby="mkt-reviews-title">
      <h2 id="mkt-reviews-title" className="mb-4 text-xl font-bold text-[var(--navy)]">{t("title")}</h2>
      <div className="mb-6 flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div className="text-center sm:w-40">
          <p className="text-5xl font-black text-slate-900">{data.average?.toFixed(1)}</p>
          <StarRating value={data.average ?? 0} size="text-lg" />
          <p className="mt-1 text-xs text-slate-500">{t("reviewCount", { count: data.count })}</p>
        </div>
        <ul className="flex-1 space-y-1.5">
          {(["5", "4", "3", "2", "1"] as const).map((stars) => {
            const percent = Math.round((data.distribution[stars] * 100) / data.count);
            return (
              <li key={stars} className="flex items-center gap-3 text-xs text-slate-600">
                <span className="w-12 shrink-0">{t("starsLabel", { count: Number(stars) })}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-amber-400" style={{ width: `${percent}%` }} />
                </span>
                <span className="w-9 shrink-0 text-right">{percent}%</span>
              </li>
            );
          })}
        </ul>
      </div>
      <ul className="space-y-4">
        {data.results.map((review) => (
          <li key={review.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--navy)] text-sm font-bold text-white" aria-hidden>
                {review.author_name.charAt(0).toUpperCase()}
              </span>
              <span className="font-semibold text-slate-900">{review.author_name}</span>
              {review.verified_purchase && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">✓ {t("verifiedPurchase")}</span>}
              <span className="ml-auto text-xs text-slate-400">{new Date(review.created_at).toLocaleDateString(locale, { dateStyle: "medium" })}</span>
            </div>
            <StarRating value={review.score} />
            {review.text && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{review.text}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

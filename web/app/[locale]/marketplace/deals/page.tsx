"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useMarketplaceFeed } from "@/lib/useMarketplaceListings";
import MarketplaceListingCard from "@/components/MarketplaceListingCard";
import LoadMoreButton from "@/components/LoadMoreButton";
import CartLink from "@/components/CartLink";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";

const DEALS_QUERY = { on_sale: "1", ordering: "ending_soon" };

/** Running flash sales, soonest-ending first. */
export default function MarketplaceDealsPage() {
  const t = useTranslations("MarketplaceDeals");
  const { items, status, hasMore, loadingMore, loadMore, total, retry } = useMarketplaceFeed("all", DEALS_QUERY);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/marketplace" className="mb-2 inline-flex min-h-10 items-center text-sm font-semibold text-[var(--navy)] underline">← {t("back")}</Link>
          <h1 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--navy)] md:text-4xl">⚡ {t("title")}</h1>
          <p className="max-w-xl text-sm text-slate-500 md:text-base">{t("subtitle")}</p>
        </div>
        <CartLink />
      </div>

      {status === "loading" ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{t("loadFailed")}</p>
          <button type="button" onClick={retry} className="min-h-10 font-semibold underline">{t("retry")}</button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon="⚡" title={t("emptyTitle")} description={t("emptyBody")} action={<Button href="/marketplace">{t("browseAll")}</Button>} />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500" aria-live="polite">{t("resultCount", { count: total })}</p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {items.map((listing) => <MarketplaceListingCard key={`${listing.category}-${listing.id}`} listing={listing} />)}
          </div>
          {hasMore && <LoadMoreButton onClick={loadMore} loading={loadingMore} />}
        </>
      )}
    </main>
  );
}

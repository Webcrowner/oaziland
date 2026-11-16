"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { getMarketplaceShop, toggleFollow, type MarketplaceShop } from "@/lib/api";
import { loginHref } from "@/lib/authRedirect";
import { useMarketplaceFeed } from "@/lib/useMarketplaceListings";
import MarketplaceListingCard from "@/components/MarketplaceListingCard";
import LoadMoreButton from "@/components/LoadMoreButton";
import CartLink from "@/components/CartLink";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";

type Tab = "listings" | "deals" | "about" | "policies";
const TABS: Tab[] = ["listings", "deals", "about", "policies"];

function ShopListings({ listerId, deals }: { listerId: string; deals: boolean }) {
  const t = useTranslations("ShopStorefront");
  const { items, status, hasMore, loadingMore, loadMore, total, retry } = useMarketplaceFeed(
    "all",
    deals ? { lister_id: listerId, on_sale: "1", ordering: "ending_soon" } : { lister_id: listerId, ordering: "newest" },
  );

  if (status === "loading") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-slate-100" />)}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
        <p>{t("loadFailed")}</p>
        <button type="button" onClick={retry} className="min-h-10 font-semibold underline">{t("retry")}</button>
      </div>
    );
  }
  if (items.length === 0) return <EmptyState icon={deals ? "⚡" : "🛍️"} title={deals ? t("noDeals") : t("noListings")} />;
  return (
    <>
      <p className="mb-3 text-sm text-slate-500" aria-live="polite">{t("resultCount", { count: total })}</p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {items.map((listing) => <MarketplaceListingCard key={`${listing.category}-${listing.id}`} listing={listing} />)}
      </div>
      {hasMore && <LoadMoreButton onClick={loadMore} loading={loadingMore} />}
    </>
  );
}

/** A seller's public shop: branding, follow button, announcement, listings and deals, about and policies. */
export default function ShopStorefrontPage() {
  const t = useTranslations("ShopStorefront");
  const format = useFormatter();
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();
  const [shop, setShop] = useState<MarketplaceShop | null>(null);
  const [status, setStatus] = useState<"loading" | "notFound" | "error" | "ready">("loading");
  const [tab, setTab] = useState<Tab>("listings");
  const [following, setFollowing] = useState(false);
  const [followError, setFollowError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let stale = false;
    getMarketplaceShop(userId, localStorage.getItem("access_token"))
      .then((data) => { if (!stale) { setShop(data); setStatus("ready"); } })
      .catch((err: unknown) => { if (!stale) setStatus(err instanceof Error && /not found/i.test(err.message) ? "notFound" : "error"); });
    return () => { stale = true; };
  }, [userId, reloadKey]);

  async function follow() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push(loginHref(`/marketplace/shop/${userId}`));
      return;
    }
    setFollowing(true);
    setFollowError("");
    try {
      const result = await toggleFollow(userId, token);
      setShop((current) => (current ? { ...current, is_following: result.is_following, follower_count: result.follower_count } : current));
    } catch (err) {
      setFollowError(err instanceof Error ? err.message : t("followFailed"));
    } finally {
      setFollowing(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6" aria-busy="true">
        <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
      </main>
    );
  }
  if (status !== "ready" || !shop) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <EmptyState
          icon="🏬" title={status === "notFound" ? t("notFound") : t("loadFailed")}
          action={status === "notFound" ? <Button href="/marketplace">{t("browse")}</Button> : <Button onClick={() => { setStatus("loading"); setReloadKey((key) => key + 1); }}>{t("retry")}</Button>}
        />
      </main>
    );
  }

  const { seller } = shop;
  const backOn = shop.vacation_until ? format.dateTime(new Date(`${shop.vacation_until}T12:00:00`), { dateStyle: "long" }) : "";
  const tabCount = (value: Tab) => (value === "listings" ? shop.listing_count : value === "deals" ? shop.deal_count : null);

  return (
    <main className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/marketplace" className="inline-flex min-h-10 items-center text-sm font-semibold text-[var(--navy)] underline">← {t("back")}</Link>
        <CartLink />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="h-28 bg-gradient-to-br from-[var(--navy)] via-slate-700 to-amber-500 sm:h-44">
          {shop.banner_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shop.banner_url} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-9 flex items-end gap-3 sm:-mt-11">
            <div className="flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-slate-100 text-2xl font-black text-[var(--navy)] shadow sm:h-24 sm:w-24">
              {shop.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shop.logo_url} alt={t("logoAlt", { name: shop.name })} className="h-full w-full object-cover" />
              ) : (
                <span aria-hidden>{shop.name.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="break-words font-[family-name:var(--font-display)] text-xl font-bold text-[var(--navy)] sm:text-3xl">{shop.name}</h1>
              {shop.tagline && <p className="mt-0.5 break-words text-sm text-slate-600">{shop.tagline}</p>}
              <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                {seller.id_verified && <li className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">✓ {t("verified")}</li>}
                <li>
                  {seller.rating_avg != null ? <>★ <strong className="text-slate-800">{seller.rating_avg}</strong> ({seller.rating_count})</> : t("noRatings")}
                </li>
                <li>{t("itemsSold", { count: seller.items_sold })}</li>
                <li>{t("followers", { count: shop.follower_count })}</li>
              </ul>
              <Link href={`/user/${shop.user_id}`} className="mt-1 inline-flex min-h-10 items-center text-xs text-slate-500 underline">{t("profileLink")}</Link>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              {shop.is_owner ? (
                <Button href="/marketplace/shop-settings" variant="secondary">{t("editShop")}</Button>
              ) : (
                <Button onClick={follow} disabled={following} variant={shop.is_following ? "secondary" : "primary"} aria-pressed={shop.is_following}>
                  {shop.is_following ? t("unfollow") : t("follow")}
                </Button>
              )}
              {followError && <p role="alert" className="text-sm text-red-700">{followError}</p>}
            </div>
          </div>
        </div>
      </div>

      {shop.announcement && (
        <p role="note" className="mt-3 break-words rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">📣 {shop.announcement}</p>
      )}
      {shop.coupon_available && (
        <p className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">🏷️ {t("hasCoupons")}</p>
      )}

      <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2" role="tablist" aria-label={t("tabsLabel")}>
          {TABS.map((value) => {
            const count = tabCount(value);
            return (
              <button
                key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                className={`min-h-10 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold cursor-pointer ${
                  tab === value ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-slate-300 bg-white text-slate-700 hover:border-[var(--navy)]"
                }`}
              >
                {t(`tab_${value}`)}{count !== null ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4" role="tabpanel">
        {(tab === "listings" || tab === "deals") && (
          shop.on_vacation ? (
            <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
              <p className="mb-1 text-lg font-bold">🌴 {t("vacationTitle")}</p>
              {shop.vacation_message && <p className="mb-1 break-words text-sm">{shop.vacation_message}</p>}
              <p className="text-sm">{backOn ? t("backOn", { date: backOn }) : t("vacationNoDate")}</p>
            </div>
          ) : (
            <ShopListings key={tab} listerId={shop.user_id} deals={tab === "deals"} />
          )
        )}
        {tab === "about" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 className="mb-2 text-base font-bold text-[var(--navy)]">{t("aboutTitle")}</h2>
            <p className="whitespace-pre-line break-words text-sm text-slate-700">{shop.description || t("noDescription")}</p>
          </section>
        )}
        {tab === "policies" && (
          <div className="grid gap-3 md:grid-cols-2">
            {(["shipping", "return"] as const).map((kind) => {
              const text = kind === "shipping" ? shop.shipping_policy : shop.return_policy;
              return (
                <section key={kind} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <h2 className="mb-2 text-base font-bold text-[var(--navy)]">{t(`${kind}PolicyTitle`)}</h2>
                  <p className={`whitespace-pre-line break-words text-sm ${text ? "text-slate-700" : "text-slate-500"}`}>{text || t("noPolicy")}</p>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

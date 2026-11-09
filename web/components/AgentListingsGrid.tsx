"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listAgentListings, type AgentListingCard } from "@/lib/api";

const PAGE = 12;

/** An agent's live listings, with "See more" loading the next page. */
export default function AgentListingsGrid({ userId, initial }: { userId: string; initial: { count: number; results: AgentListingCard[]; next_offset: number | null } }) {
  const t = useTranslations("AgentProfilePage");
  const [items, setItems] = useState(initial.results);
  const [nextOffset, setNextOffset] = useState(initial.next_offset);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function more() {
    if (nextOffset === null) return;
    setLoading(true);
    setFailed(false);
    try {
      const page = await listAgentListings(userId, nextOffset, PAGE);
      setItems((prev) => [...prev, ...page.results]);
      setNextOffset(page.next_offset);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) return <p className="text-sm text-slate-500">{t("noListingsYet")}</p>;

  return (
    <>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((listing) => (
          <li key={listing.id}>
            <Link href={listing.path} className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white hover:shadow-md">
              {listing.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- listing photos from arbitrary storage hosts
                <img src={listing.photo_url} alt="" className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-xs text-slate-400">{t("noPhoto")}</div>
              )}
              <div className="p-2.5">
                <p className="text-sm font-black text-slate-900">{Number(listing.price_xaf).toLocaleString()} XAF</p>
                <p className="truncate text-xs text-slate-500">
                  {t(`listingType_${listing.listing_type}`)} · {listing.quarter_name}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {failed && <p role="alert" className="mt-3 text-sm text-red-600">{t("loadMoreFailed")}</p>}
      {nextOffset !== null && (
        <button
          type="button" onClick={more} disabled={loading}
          className="mt-4 w-full rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          {loading ? t("loading") : t("seeMore", { count: initial.count - items.length })}
        </button>
      )}
    </>
  );
}

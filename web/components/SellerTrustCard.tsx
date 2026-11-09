"use client";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMarketplaceSeller, type MarketplaceSellerSummary } from "@/lib/api";
import ListerRoleBadge from "@/components/ListerRoleBadge";
import HideForOwner from "@/components/HideForOwner";
import RateAndReport from "@/components/RateAndReport";

/** Who you're dealing with, like the seller box on Jiji or Facebook Marketplace: verified ID, rating, member
 * since, items sold, other listings and how quickly they usually reply. */
export default function SellerTrustCard({ sellerId, listerRole, isSale }: { sellerId: string; listerRole?: string; isSale?: boolean }) {
  const t = useTranslations("SellerCard");
  const format = useFormatter();
  const [seller, setSeller] = useState<MarketplaceSellerSummary | null>(null);

  useEffect(() => {
    getMarketplaceSeller(sellerId).then(setSeller).catch(() => {});
  }, [sellerId]);

  const replyText = (hours: number) =>
    hours < 1 ? t("repliesWithinHour") : hours < 24 ? t("repliesWithinHours", { hours: Math.ceil(hours) }) : t("repliesWithinDays", { days: Math.ceil(hours / 24) });

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
      <ListerRoleBadge role={listerRole} isSale={isSale} />
      <div className="mt-1 flex items-center gap-2">
        <Link href={`/user/${sellerId}`} className="font-semibold text-[var(--navy)] hover:text-[var(--gold)]">{seller?.name ?? t("seller")}</Link>
        {seller?.id_verified && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">✓ {t("idVerified")}</span>}
      </div>
      {seller && (
        <ul className="mt-2 flex flex-col gap-1 text-slate-600">
          <li>
            {seller.rating_avg != null
              ? <>★ <strong className="text-slate-800">{seller.rating_avg}</strong> {t("ratings", { count: seller.rating_count })}</>
              : t("noRatings")}
          </li>
          <li>{t("memberSince", { date: format.dateTime(new Date(`${seller.member_since}T12:00:00`), { month: "long", year: "numeric" }) })}</li>
          <li>{t("itemsSold", { count: seller.items_sold })} · <Link href={`/user/${sellerId}`} className="underline">{t("activeListings", { count: seller.active_listings })}</Link></li>
          {seller.reply_time_hours != null && seller.reply_rate_pct != null && (
            <li>⏱ {replyText(seller.reply_time_hours)} · {t("replyRate", { pct: seller.reply_rate_pct })}</li>
          )}
          {seller.last_seen_at && <li>{t("lastSeen", { when: format.relativeTime(new Date(seller.last_seen_at), new Date()) })}</li>}
        </ul>
      )}
      <div className="mt-3 border-t border-black/10 pt-3">
        <HideForOwner ownerId={sellerId}><RateAndReport subjectUserId={sellerId} /></HideForOwner>
      </div>
    </div>
  );
}

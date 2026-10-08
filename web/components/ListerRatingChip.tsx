"use client";
import { useTranslations } from "next-intl";
import { IconStar } from "./Icons";

/** The lister's average rating, shown on every browse card. */
export default function ListerRatingChip({ average, count }: { average?: number | null; count?: number }) {
  const t = useTranslations("PropertyCard");
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
      <IconStar size={12} className="text-amber-500" />
      {average != null ? `${average.toFixed(1)} (${count ?? 0})` : t("noRatingsYet")}
    </span>
  );
}

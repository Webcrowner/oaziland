"use client";
import { useTranslations } from "next-intl";

export default function LoadMoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  const t = useTranslations("MarketplaceFilters");
  return (
    <div className="flex justify-center mt-8">
      <button
        onClick={onClick}
        disabled={loading}
        className="px-6 py-2.5 rounded-lg border border-[var(--navy)] text-[var(--navy)] font-semibold text-sm hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
      >
        {loading ? t("loadingMore") : t("loadMore")}
      </button>
    </div>
  );
}

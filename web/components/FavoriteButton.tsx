"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { getMyFavorites, toggleFavoriteListing } from "@/lib/api";

/**
 * A small, self-contained client island — kept separate from
 * PropertyCard (and the listing detail page) so those stay server-
 * rendered for SEO, exactly like ContactListingButton does for the
 * WhatsApp contact action.
 */
export default function FavoriteButton({ listingId, variant = "card" }: { listingId: string; variant?: "card" | "detail" }) {
  const t = useTranslations(variant === "card" ? "PropertyCard" : "ListingDetailPage");
  const router = useRouter();
  const [isFavorited, setIsFavorited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyFavorites(token)
      .then((data) => setIsFavorited(data.listing_ids.includes(listingId)))
      .catch(() => {});
  }, [listingId]);

  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault(); // stop the surrounding card <Link> from navigating
    e.stopPropagation();
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const result = await toggleFavoriteListing(listingId, token);
      setIsFavorited(result.is_favorited);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (variant === "card") {
    return (
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`absolute top-2 left-2 z-10 w-9 h-9 rounded-full flex items-center justify-center text-lg transition-colors ${
          isFavorited ? "bg-[var(--gold)] text-white" : "bg-white/90 text-gray-500 hover:text-[var(--gold)]"
        }`}
        aria-label={t(isFavorited ? "saved" : "save")}
      >
        {isFavorited ? "★" : "☆"}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`font-semibold px-4 py-2 rounded border ${
          isFavorited ? "bg-[var(--gold)] text-white border-[var(--gold)]" : "border-[var(--navy)] text-[var(--navy)] hover:bg-gray-50"
        }`}
      >
        {isFavorited ? "★ " + t("saved") : "☆ " + t("save")}
      </button>
      {failed && <p className="text-red-600 text-xs mt-1">{t("saveFailed")}</p>}
    </div>
  );
}

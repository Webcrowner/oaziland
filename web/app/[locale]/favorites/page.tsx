"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PropertyCard from "@/components/PropertyCard";
import { getMyFavorites, getListing, type Listing } from "@/lib/api";

export default function FavoritesPage() {
  const t = useTranslations("FavoritesPage");
  const [listings, setListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    getMyFavorites(token)
      .then(async (data) => {
        const fetched = await Promise.all(data.listing_ids.map((id) => getListing(id).catch(() => null)));
        setListings(fetched.filter((l): l is Listing => l !== null));
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Link href="/login" className="inline-block bg-[#1B2A4A] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("signInRequired")}
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-8">{t("subtitle")}</p>

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : listings.length === 0 ? (
        <p className="text-gray-500">{t("noFavoritesYet")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => (
            <PropertyCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </main>
  );
}

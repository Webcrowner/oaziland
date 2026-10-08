"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import PropertyCard from "@/components/PropertyCard";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
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
      <AccountSidebarLayout activeHref="/favorites">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  return (
    <AccountSidebarLayout activeHref="/favorites">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : listings.length === 0 ? (
        <EmptyState icon="❤️" title={t("noFavoritesYet")} action={<Button variant="secondary" href="/search">{t("browseListings")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => (
            <PropertyCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </AccountSidebarLayout>
  );
}

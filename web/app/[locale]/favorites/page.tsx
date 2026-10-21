"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import PropertyCard from "@/components/PropertyCard";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { getMyFavorites, getListing, type Listing, type SavedMarketplaceListing } from "@/lib/api";
import { Link } from "@/i18n/navigation";
import FavoriteButton from "@/components/FavoriteButton";

const PRICE_BASIS_LABELS: Record<string, string> = {
  SALE: "For Sale", RENT_NIGHTLY: "Rent / Night", RENT_WEEKLY: "Rent / Week", RENT_MONTHLY: "Rent / Month", RENT_ANNUAL: "Rent / Year",
};

export default function FavoritesPage() {
  const t = useTranslations("FavoritesPage");
  const [listings, setListings] = useState<Listing[]>([]);
  const [marketplace, setMarketplace] = useState<SavedMarketplaceListing[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const favorites = token ? getMyFavorites(token) : null;
    if (!favorites) {
      Promise.resolve().then(() => setStatus("signedOut"));
      return;
    }
    favorites
      .then(async (data) => {
        const marketplaceIds = new Set(data.marketplace_listings.map((m) => m.id));
        const propertyIds = data.listing_ids.filter((id) => !marketplaceIds.has(id));
        const fetched = await Promise.all(propertyIds.map((id) => getListing(id).catch(() => null)));
        setListings(fetched.filter((l): l is Listing => l !== null));
        setMarketplace(data.marketplace_listings);
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
      ) : listings.length === 0 && marketplace.length === 0 ? (
        <EmptyState icon="❤️" title={t("noFavoritesYet")} action={<Button variant="secondary" href="/search">{t("browseListings")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => (
            <PropertyCard key={listing.id} listing={listing} />
          ))}
          {marketplace.map((item) => (
            <div key={item.id} className="relative border border-slate-200/80 rounded-2xl overflow-hidden bg-white">
              <Link href={`/marketplace/${item.category}/${item.id}`} className="block">
                {item.photo_url ? (
                  <div className="h-40 bg-gray-100"><img src={item.photo_url} alt="" className="w-full h-full object-cover" /></div>
                ) : (
                  <div className="h-40 bg-slate-100 flex items-center justify-center text-slate-400 text-sm font-medium">{t("noPhotoYet")}</div>
                )}
                <div className="p-4">
                  <p className="font-semibold text-[var(--navy)] mb-1">{item.title}</p>
                  <p className="text-xs text-gray-500 mb-1">{PRICE_BASIS_LABELS[item.price_basis] ?? item.price_basis}{item.quarter_name ? ` · ${item.quarter_name}` : ""}</p>
                  <p className="text-lg font-bold text-[var(--navy)]">{Number(item.price_xaf).toLocaleString()} XAF</p>
                  {item.availability_status !== "AVAILABLE" && <p className="text-xs text-[var(--clay)] mt-1">{t("notAvailable")}</p>}
                </div>
              </Link>
              <FavoriteButton listingId={item.id} />
            </div>
          ))}
        </div>
      )}
    </AccountSidebarLayout>
  );
}

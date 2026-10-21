"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createMarketplaceListing, addMarketplaceMedia, listQuarters, type CarListing, type Quarter, type MediaUploadResult } from "@/lib/api";
import { useMarketplaceListings } from "@/lib/useMarketplaceListings";
import LoadMoreButton from "@/components/LoadMoreButton";
import MarketplaceFilterBar, { EMPTY_MARKETPLACE_FILTERS, filtersActive, filtersToQuery, type MarketplaceFilters } from "@/components/MarketplaceFilterBar";
import FavoriteButton from "@/components/FavoriteButton";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import MediaThumbs from "@/components/MediaThumbs";
import LocationCapture, { EMPTY_GPS, type GpsValue } from "@/components/LocationCapture";
import ListerRoleBadge from "@/components/ListerRoleBadge";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";
import { Link } from "@/i18n/navigation";
import DirectChatButton from "@/components/DirectChatButton";

const PRICE_BASIS_LABELS: Record<string, string> = {
  SALE: "For Sale", RENT_NIGHTLY: "Rent / Night", RENT_WEEKLY: "Rent / Week", RENT_MONTHLY: "Rent / Month", RENT_ANNUAL: "Rent / Year",
};

/**
 * Cars — the richest of the four marketplace categories, with a real
 * composed VehicleSpec written in the same request as the listing
 * itself, not a separate manual step. Now also with real photo
 * upload and display, closing a gap found while continuing the
 * redesign pass: MarketplaceMedia already existed but nothing ever
 * let a lister actually attach one.
 */
export default function CarsMarketplacePage() {
  const t = useTranslations("MarketplaceCategoryPage");
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [priceBasis, setPriceBasis] = useState("SALE");
  const [price, setPrice] = useState("");
  const [quarterId, setQuarterId] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [mileage, setMileage] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [gps, setGps] = useState<GpsValue>(EMPTY_GPS);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  const [filters, setFilters] = useState<MarketplaceFilters>(EMPTY_MARKETPLACE_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);
  const { items: listings, status, hasMore, loadingMore, loadMore } = useMarketplaceListings<CarListing>("cars", filtersToQuery(filters), reloadKey);

  useEffect(() => {
    listQuarters().then(setQuarters).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSubmitStatus("submitting");
    try {
      const listing = await createMarketplaceListing("cars", {
        title, price_basis: priceBasis, price_xaf: price, quarter: quarterId || null,
        latitude: gps.latitude, longitude: gps.longitude,
        vehicle_spec: { make, model, year: Number(year), mileage_km: mileage ? Number(mileage) : null },
      }, token);
      for (const m of media) await addMarketplaceMedia("cars", listing.id, m.url, m.media_type, token);
      setShowForm(false);
      setTitle(""); setPrice(""); setMake(""); setModel(""); setYear(""); setMileage(""); setMedia([]); setGps(EMPTY_GPS);
      setReloadKey((k) => k + 1);
    } catch {
      setErrorText(t("submitFailed"));
      setSubmitStatus("error");
      return;
    }
    setSubmitStatus("idle");
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={t("carsTitle")} subtitle={t("carsSubtitle")}
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? t("cancel") : t("listACar")}</Button>}
      />

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <input required placeholder={t("titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
          <input required placeholder={t("makePlaceholder")} value={make} onChange={(e) => setMake(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input required placeholder={t("modelPlaceholder")} value={model} onChange={(e) => setModel(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input required type="number" placeholder={t("yearPlaceholder")} value={year} onChange={(e) => setYear(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input type="number" placeholder={t("mileagePlaceholder")} value={mileage} onChange={(e) => setMileage(e.target.value)} className="border rounded-lg px-3 py-2" />
          <select value={priceBasis} onChange={(e) => setPriceBasis(e.target.value)} className="border rounded-lg px-3 py-2">
            {Object.entries(PRICE_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input required type="number" placeholder={t("pricePlaceholder")} value={price} onChange={(e) => setPrice(e.target.value)} className="border rounded-lg px-3 py-2" />
          <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" required>
            <option value="" disabled>{t("chooseNeighborhood")}</option>
            <QuarterOptions quarters={quarters} />
          </select>
          <MissingAreaRequest quarters={quarters} className="md:col-span-2" />
          <LocationCapture className="md:col-span-2" value={gps} onChange={setGps} />
          <div className="md:col-span-2">
            <MediaUploader folder="marketplace" onUploaded={(m) => setMedia((prev) => [...prev, m])} label={t("addPhotoOrVideo")} />
            {media.length > 0 && <p className="text-xs text-gray-500 mt-1">{t("mediaAttached", { count: media.length })}</p>}
            <MediaThumbs items={media.map((m) => ({ url: m.url, media_type: m.media_type }))} onRemove={(i) => setMedia((prev) => prev.filter((_, idx) => idx !== i))} />
          </div>
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{errorText}</p>}
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitListing")}</Button>
        </form>
      )}

      <MarketplaceFilterBar value={filters} onChange={setFilters} />

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : listings.length === 0 ? (
        filtersActive(filters)
          ? <EmptyState icon="🚗" title={t("noMatches")} />
          : <EmptyState icon="🚗" title={t("noCarsYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listACar")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => {
            const photo = listing.media.find((m) => m.media_type === "PHOTO");
            return (
              <Card key={listing.id}>
                <div className="relative">
                <Link href={`/marketplace/cars/${listing.id}`} className="block">
                {photo ? (
                  <div className="h-40 bg-gray-100"><img src={photo.file_url} alt="" className="w-full h-full object-cover" /></div>
                ) : (
                  <CardMedia label={t("noPhotoYet")} />
                )}
                </Link>
                <FavoriteButton listingId={listing.id} />
                </div>
                <CardBody>
                  <div className="flex items-center justify-between mb-2">
                    <ListerRoleBadge role={listing.lister_role} isSale={listing.price_basis === "SALE"} />
                    <WhatsAppShareButton title="car" location={listing.quarter_name ?? ""} price={Number(listing.price_xaf).toLocaleString()} path={`/marketplace/cars/${listing.id}`} />
                  </div>
                  <p className="font-semibold text-[var(--navy)] mb-1">{listing.title}</p>
                  <p className="text-sm text-gray-500 mb-2">{listing.vehicle_spec.year} {listing.vehicle_spec.make} {listing.vehicle_spec.model}</p>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="gold">{PRICE_BASIS_LABELS[listing.price_basis]}</Badge>
                    {listing.quarter_name && <Badge variant="neutral">{listing.quarter_name}</Badge>}
                  </div>
                  <p className="text-lg font-bold text-[var(--navy)] mb-3">{Number(listing.price_xaf).toLocaleString()} XAF</p>

                  <DirectChatButton
                    recipientId={listing.lister_user}
                    recipientName={listing.lister_name}
                    label={t("chatWithSeller") || "Chat with Seller"}
                    className="w-full inline-flex items-center justify-center gap-1.5 bg-[var(--navy)] text-white font-semibold px-3 py-2 rounded-lg text-xs hover:bg-slate-800 transition-colors"
                  />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
      {status === "ready" && hasMore && <LoadMoreButton onClick={loadMore} loading={loadingMore} />}
    </main>
  );
}

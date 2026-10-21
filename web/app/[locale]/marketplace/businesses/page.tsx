"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createMarketplaceListing, addMarketplaceMedia, listQuarters, type BusinessListing, type Quarter, type MediaUploadResult } from "@/lib/api";
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

export default function BusinessesMarketplacePage() {
  const t = useTranslations("MarketplaceCategoryPage");
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [includesGoodwill, setIncludesGoodwill] = useState(false);
  const [includesInventory, setIncludesInventory] = useState(false);
  const [annualRevenue, setAnnualRevenue] = useState("");
  const [quarterId, setQuarterId] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [gps, setGps] = useState<GpsValue>(EMPTY_GPS);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  const [filters, setFilters] = useState<MarketplaceFilters>(EMPTY_MARKETPLACE_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);
  const { items: listings, status, hasMore, loadingMore, loadMore } = useMarketplaceListings<BusinessListing>("businesses", filtersToQuery(filters), reloadKey);

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
      const listing = await createMarketplaceListing("businesses", {
        title, price_basis: "SALE", price_xaf: price, includes_goodwill: includesGoodwill,
        includes_inventory: includesInventory, annual_revenue_xaf: annualRevenue || null, quarter: quarterId || null,
        latitude: gps.latitude, longitude: gps.longitude,
      }, token);
      for (const m of media) await addMarketplaceMedia("businesses", listing.id, m.url, m.media_type, token);
      setShowForm(false);
      setTitle(""); setPrice(""); setAnnualRevenue(""); setIncludesGoodwill(false); setIncludesInventory(false); setMedia([]); setGps(EMPTY_GPS);
      setReloadKey((k) => k + 1);
    } catch {
      setSubmitStatus("error");
      return;
    }
    setSubmitStatus("idle");
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={t("businessesTitle")} subtitle={t("businessesSubtitle")}
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? t("cancel") : t("listABusiness")}</Button>}
      />

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <input required placeholder={t("titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
          <input required type="number" placeholder={t("askingPricePlaceholder")} value={price} onChange={(e) => setPrice(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input type="number" placeholder={t("annualRevenuePlaceholder")} value={annualRevenue} onChange={(e) => setAnnualRevenue(e.target.value)} className="border rounded-lg px-3 py-2" />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={includesGoodwill} onChange={(e) => setIncludesGoodwill(e.target.checked)} /> {t("includesGoodwill")}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={includesInventory} onChange={(e) => setIncludesInventory(e.target.checked)} /> {t("includesInventory")}
          </label>
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
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{t("submitFailed")}</p>}
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitListing")}</Button>
        </form>
      )}

      <MarketplaceFilterBar value={filters} onChange={setFilters} showPriceBasis={false} />

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : listings.length === 0 ? (
        filtersActive(filters)
          ? <EmptyState icon="💼" title={t("noMatches")} />
          : <EmptyState icon="💼" title={t("noBusinessesYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listABusiness")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => {
            const photo = listing.media.find((m) => m.media_type === "PHOTO");
            return (
              <Card key={listing.id}>
                <div className="relative">
                <Link href={`/marketplace/businesses/${listing.id}`} className="block">
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
                    <WhatsAppShareButton title="business" location={listing.quarter_name ?? ""} price={Number(listing.price_xaf).toLocaleString()} path={`/marketplace/businesses/${listing.id}`} />
                  </div>
                  <p className="font-semibold text-[var(--navy)] mb-1">{listing.title}</p>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {listing.includes_goodwill && <Badge variant="green">{t("includesGoodwill")}</Badge>}
                    {listing.includes_inventory && <Badge variant="green">{t("includesInventory")}</Badge>}
                    {listing.quarter_name && <Badge variant="neutral">{listing.quarter_name}</Badge>}
                  </div>
                  <p className="text-lg font-bold text-[var(--navy)] mb-3">{Number(listing.price_xaf).toLocaleString()} XAF</p>

                  <DirectChatButton
                    recipientId={listing.lister_user}
                    recipientName={listing.lister_name}
                    label="Chat with Business Seller"
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

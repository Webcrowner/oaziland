"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { listMarketplaceListings, createMarketplaceListing, addMarketplaceMedia, listQuarters, type StoreListing, type Quarter, type MediaUploadResult } from "@/lib/api";
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

export default function StoresMarketplacePage() {
  const t = useTranslations("MarketplaceCategoryPage");
  const [listings, setListings] = useState<StoreListing[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [priceBasis, setPriceBasis] = useState("RENT_MONTHLY");
  const [price, setPrice] = useState("");
  const [sizeSqm, setSizeSqm] = useState("");
  const [frontage, setFrontage] = useState("");
  const [quarterId, setQuarterId] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [gps, setGps] = useState<GpsValue>(EMPTY_GPS);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  const load = useCallback(() => {
    listMarketplaceListings<StoreListing>("stores")
      .then((data) => setListings(data.results)).catch(() => setListings([])).finally(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    load();
    listQuarters().then(setQuarters).catch(() => {});
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSubmitStatus("submitting");
    try {
      const listing = await createMarketplaceListing("stores", {
        title, price_basis: priceBasis, price_xaf: price, size_sqm: sizeSqm,
        frontage_meters: frontage || null, quarter: quarterId || null,
        latitude: gps.latitude, longitude: gps.longitude,
      }, token);
      for (const m of media) await addMarketplaceMedia("stores", listing.id, m.url, m.media_type, token);
      setShowForm(false);
      setTitle(""); setPrice(""); setSizeSqm(""); setFrontage(""); setMedia([]); setGps(EMPTY_GPS);
      load();
    } catch {
      setSubmitStatus("error");
      return;
    }
    setSubmitStatus("idle");
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={t("storesTitle")} subtitle={t("storesSubtitle")}
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? t("cancel") : t("listAStore")}</Button>}
      />

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <input required placeholder={t("titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
          <input required type="number" placeholder={t("sizeSqmPlaceholder")} value={sizeSqm} onChange={(e) => setSizeSqm(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input type="number" placeholder={t("frontagePlaceholder")} value={frontage} onChange={(e) => setFrontage(e.target.value)} className="border rounded-lg px-3 py-2" />
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
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{t("submitFailed")}</p>}
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitListing")}</Button>
        </form>
      )}

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : listings.length === 0 ? (
        <EmptyState icon="🏬" title={t("noStoresYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listAStore")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => {
            const photo = listing.media.find((m) => m.media_type === "PHOTO");
            return (
            <Card key={listing.id}>
              <Link href={`/marketplace/stores/${listing.id}`} className="block">
              {photo ? (
                <div className="h-40 bg-gray-100"><img src={photo.file_url} alt="" className="w-full h-full object-cover" /></div>
              ) : (
                <CardMedia label={t("noPhotoYet")} />
              )}
              </Link>
              <CardBody>
                <div className="flex items-center justify-between mb-2">
                  <ListerRoleBadge role={listing.lister_role} isSale={listing.price_basis === "SALE"} />
                  <WhatsAppShareButton title="store" location={listing.quarter_name ?? ""} price={Number(listing.price_xaf).toLocaleString()} path={`/marketplace/stores/${listing.id}`} />
                </div>
                <p className="font-semibold text-[var(--navy)] mb-1">{listing.title}</p>
                <p className="text-sm text-gray-500 mb-2">{listing.size_sqm} m²{listing.frontage_meters && ` · ${listing.frontage_meters}m frontage`}</p>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="gold">{PRICE_BASIS_LABELS[listing.price_basis]}</Badge>
                  {listing.quarter_name && <Badge variant="neutral">{listing.quarter_name}</Badge>}
                </div>
                <p className="text-lg font-bold text-[var(--navy)] mb-3">{Number(listing.price_xaf).toLocaleString()} XAF</p>

                <DirectChatButton
                  recipientId={listing.lister_user}
                  recipientName={listing.lister_name}
                  label="Chat with Owner / Seller"
                  className="w-full inline-flex items-center justify-center gap-1.5 bg-[var(--navy)] text-white font-semibold px-3 py-2 rounded-lg text-xs hover:bg-slate-800 transition-colors"
                />
              </CardBody>
            </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

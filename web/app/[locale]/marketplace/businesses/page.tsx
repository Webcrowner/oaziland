"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { listMarketplaceListings, createMarketplaceListing, addMarketplaceMedia, listQuarters, type BusinessListing, type Quarter, type MediaUploadResult } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";

export default function BusinessesMarketplacePage() {
  const t = useTranslations("MarketplaceCategoryPage");
  const [listings, setListings] = useState<BusinessListing[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [includesGoodwill, setIncludesGoodwill] = useState(false);
  const [includesInventory, setIncludesInventory] = useState(false);
  const [annualRevenue, setAnnualRevenue] = useState("");
  const [quarterId, setQuarterId] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  const load = useCallback(() => {
    listMarketplaceListings<BusinessListing>("businesses")
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
      const listing = await createMarketplaceListing("businesses", {
        title, price_basis: "SALE", price_xaf: price, includes_goodwill: includesGoodwill,
        includes_inventory: includesInventory, annual_revenue_xaf: annualRevenue || null, quarter: quarterId || null,
      }, token);
      await Promise.all(media.map((m) => addMarketplaceMedia("businesses", listing.id, m.url, m.media_type, token)));
      setShowForm(false);
      setTitle(""); setPrice(""); setAnnualRevenue(""); setIncludesGoodwill(false); setIncludesInventory(false); setMedia([]);
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
          <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2">
            <option value="">{t("chooseNeighborhood")}</option>
            {quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          <div className="md:col-span-2">
            <MediaUploader folder="marketplace" onUploaded={(m) => setMedia((prev) => [...prev, m])} label={t("addPhotoOrVideo")} />
            {media.length > 0 && <p className="text-xs text-gray-500 mt-1">{t("mediaAttached", { count: media.length })}</p>}
          </div>
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{t("submitFailed")}</p>}
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitListing")}</Button>
        </form>
      )}

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : listings.length === 0 ? (
        <EmptyState icon="💼" title={t("noBusinessesYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listABusiness")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => {
            const photo = listing.media.find((m) => m.media_type === "PHOTO");
            return (
              <Card key={listing.id}>
                {photo ? (
                  <div className="h-40 bg-gray-100"><img src={photo.file_url} alt="" className="w-full h-full object-cover" /></div>
                ) : (
                  <CardMedia label={t("noPhotoYet")} />
                )}
                <CardBody>
                  <p className="font-semibold text-[var(--navy)] mb-1">{listing.title}</p>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {listing.includes_goodwill && <Badge variant="green">{t("includesGoodwill")}</Badge>}
                    {listing.includes_inventory && <Badge variant="green">{t("includesInventory")}</Badge>}
                    {listing.quarter_name && <Badge variant="neutral">{listing.quarter_name}</Badge>}
                  </div>
                  <p className="text-lg font-bold text-[var(--navy)]">{Number(listing.price_xaf).toLocaleString()} XAF</p>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

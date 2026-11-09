"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createMarketplaceListing, listQuarters, type Quarter, type MediaUploadResult } from "@/lib/api";
import { finishMarketplacePost } from "@/lib/finishMarketplacePost";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import MediaThumbs from "@/components/MediaThumbs";
import MarketplaceConditionsFields, { EMPTY_CONDITIONS, type ConditionsDraft } from "@/components/MarketplaceConditionsFields";
import LocationCapture, { EMPTY_GPS, type GpsValue } from "@/components/LocationCapture";
import { Link, useRouter } from "@/i18n/navigation";
import SellGateNotice, { useSellGate } from "@/components/MarketplaceSellGate";
import { listingErrorMessage } from "@/lib/marketplaceErrors";

/** Post a business for sale. Browsing businesses is the marketplace page's Businesses tab. */
export default function SellBusinessPage() {
  const t = useTranslations("MarketplaceCategoryPage");
  const router = useRouter();
  const [conditions, setConditions] = useState<ConditionsDraft>(EMPTY_CONDITIONS);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [sizeSqm, setSizeSqm] = useState("");
  const [seatingCapacity, setSeatingCapacity] = useState("");
  const [includesGoodwill, setIncludesGoodwill] = useState(false);
  const [includesInventory, setIncludesInventory] = useState(false);
  const [annualRevenue, setAnnualRevenue] = useState("");
  const [quarterId, setQuarterId] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [gps, setGps] = useState<GpsValue>(EMPTY_GPS);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const gate = useSellGate();

  useEffect(() => {
    listQuarters().then(setQuarters).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setSubmitStatus("submitting");
    try {
      const listing = await createMarketplaceListing("businesses", {
        title, description, price_basis: "SALE", price_xaf: price, size_sqm: sizeSqm || null,
        seating_capacity: seatingCapacity ? Number(seatingCapacity) : null, includes_goodwill: includesGoodwill,
        includes_inventory: includesInventory, annual_revenue_xaf: annualRevenue || null, quarter: quarterId || null,
        latitude: gps.latitude, longitude: gps.longitude,
      }, token);
      router.push(await finishMarketplacePost("businesses", listing.id, media, conditions, token));
    } catch (err) {
      setErrorText(listingErrorMessage(err, t("submitFailed")));
      setSubmitStatus("error");
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={t("listABusiness")} subtitle={t("businessesSubtitle")}
        action={<Link href="/marketplace/businesses" className="text-sm font-semibold text-[var(--navy)] underline">{t("cancel")}</Link>}
      />

      <SellGateNotice gate={gate} />

      <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <input required placeholder={t("titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
        <textarea rows={3} placeholder={t("listingDescriptionPlaceholder")} value={description} onChange={(e) => setDescription(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
        <input required type="number" min="0.01" step="0.01" placeholder={t("askingPricePlaceholder")} value={price} onChange={(e) => setPrice(e.target.value)} className="border rounded-lg px-3 py-2" />
        <input type="number" min="0.01" step="0.01" placeholder={t("sizeSqmPlaceholder")} value={sizeSqm} onChange={(e) => setSizeSqm(e.target.value)} className="border rounded-lg px-3 py-2" />
        <input type="number" min="1" step="1" placeholder={t("seatingCapacityPlaceholder")} value={seatingCapacity} onChange={(e) => setSeatingCapacity(e.target.value)} className="border rounded-lg px-3 py-2" />
        <input type="number" min="0" step="0.01" placeholder={t("annualRevenuePlaceholder")} value={annualRevenue} onChange={(e) => setAnnualRevenue(e.target.value)} className="border rounded-lg px-3 py-2" />
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
        <MarketplaceConditionsFields category="businesses" value={conditions} onChange={setConditions} className="md:col-span-2" />
        {submitStatus === "error" && <p role="alert" className="text-red-600 text-sm md:col-span-2">{errorText}</p>}
        <Button className="md:col-span-2" size="lg" disabled={submitStatus === "submitting"}>{submitStatus === "submitting" ? t("submitting") : t("submitListing")}</Button>
      </form>
    </main>
  );
}

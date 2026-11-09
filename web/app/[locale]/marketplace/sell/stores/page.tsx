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

const PRICE_BASIS_LABELS: Record<string, string> = {
  SALE: "For Sale", RENT_NIGHTLY: "Rent / Night", RENT_WEEKLY: "Rent / Week", RENT_MONTHLY: "Rent / Month", RENT_ANNUAL: "Rent / Year",
};

/** Post a store (retail shopfront) for rent or sale. Browsing stores is the marketplace page's Stores tab. */
export default function SellStorePage() {
  const t = useTranslations("MarketplaceCategoryPage");
  const router = useRouter();
  const [conditions, setConditions] = useState<ConditionsDraft>(EMPTY_CONDITIONS);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceBasis, setPriceBasis] = useState("RENT_MONTHLY");
  const [price, setPrice] = useState("");
  const [deposit, setDeposit] = useState("");
  const [sizeSqm, setSizeSqm] = useState("");
  const [frontage, setFrontage] = useState("");
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
      const listing = await createMarketplaceListing("stores", {
        title, description, price_basis: priceBasis, price_xaf: price, security_deposit_xaf: priceBasis === "SALE" ? "0" : deposit || "0", size_sqm: sizeSqm,
        frontage_meters: frontage || null, quarter: quarterId || null,
        latitude: gps.latitude, longitude: gps.longitude,
      }, token);
      router.push(await finishMarketplacePost("stores", listing.id, media, conditions, token));
    } catch (err) {
      setErrorText(listingErrorMessage(err, t("submitFailed")));
      setSubmitStatus("error");
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={t("listAStore")} subtitle={t("storesSubtitle")}
        action={<Link href="/marketplace/stores" className="text-sm font-semibold text-[var(--navy)] underline">{t("cancel")}</Link>}
      />

      <SellGateNotice gate={gate} />

      <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <input required placeholder={t("titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
        <textarea rows={3} placeholder={t("listingDescriptionPlaceholder")} value={description} onChange={(e) => setDescription(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
        <input required type="number" min="0.01" step="0.01" placeholder={t("sizeSqmPlaceholder")} value={sizeSqm} onChange={(e) => setSizeSqm(e.target.value)} className="border rounded-lg px-3 py-2" />
        <input type="number" min="0.01" step="0.01" placeholder={t("frontagePlaceholder")} value={frontage} onChange={(e) => setFrontage(e.target.value)} className="border rounded-lg px-3 py-2" />
        <select value={priceBasis} onChange={(e) => setPriceBasis(e.target.value)} className="border rounded-lg px-3 py-2">
          {Object.entries(PRICE_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input required type="number" min="0.01" step="0.01" placeholder={t("pricePlaceholder")} value={price} onChange={(e) => setPrice(e.target.value)} className="border rounded-lg px-3 py-2" />
        {priceBasis !== "SALE" && (
          <input type="number" min="0" step="0.01" placeholder={t("depositPlaceholder")} value={deposit} onChange={(e) => setDeposit(e.target.value)} className="border rounded-lg px-3 py-2" />
        )}
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
        <MarketplaceConditionsFields category="stores" value={conditions} onChange={setConditions} className="md:col-span-2" />
        {submitStatus === "error" && <p role="alert" className="text-red-600 text-sm md:col-span-2">{errorText}</p>}
        <Button className="md:col-span-2" size="lg" disabled={submitStatus === "submitting"}>{submitStatus === "submitting" ? t("submitting") : t("submitListing")}</Button>
      </form>
    </main>
  );
}

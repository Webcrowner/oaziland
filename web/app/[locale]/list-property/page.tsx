"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listQuarters, createHouse, createListing, addListingPhoto, type Quarter, type MediaUploadResult } from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";

/**
 * List a Property — REWRITTEN to fix a real, genuine bug found while
 * wiring in photo/video upload: this page was still posting only
 * {listing_type, price_xaf} straight to /api/listings/, missing
 * property_asset_id entirely — the exact bug already found and fixed
 * on mobile earlier this session, apparently never actually applied
 * here. Every real submission through this page would have failed
 * with a 400. Now does the real two-step flow: create the House,
 * then the Listing referencing it, then real photo/video upload.
 */
export default function ListPropertyPage() {
  const t = useTranslations("ListPropertyPage");
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [quarterId, setQuarterId] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [description, setDescription] = useState("");
  const [listingType, setListingType] = useState("RENT");
  const [price, setPrice] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listQuarters()
      .then((data) => {
        setQuarters(data);
        if (data.length > 0) setQuarterId(data[0].id);
      })
      .catch(() => {});
  }, []);

  function handleMediaUploaded(result: MediaUploadResult) {
    setMedia((prev) => [...prev, result]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setNeedsMfa(false);
    setLoading(true);

    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setMessage({ type: "error", text: t("signInFirst") });
      setLoading(false);
      return;
    }
    if (!quarterId) {
      setMessage({ type: "error", text: t("chooseNeighborhoodError") });
      setLoading(false);
      return;
    }

    try {
      const houseRes = await createHouse(
        { quarter: quarterId, bedrooms: bedrooms ? Number(bedrooms) : undefined, description: description || undefined },
        token
      );
      if (houseRes.status === 403) {
        setMessage({ type: "error", text: t("mfaRequired") });
        setNeedsMfa(true);
        return;
      }
      if (!houseRes.ok) {
        setMessage({ type: "error", text: t("somethingWentWrong") });
        return;
      }
      const house = await houseRes.json();

      const listingRes = await createListing({ property_asset_id: house.id, listing_type: listingType, price_xaf: price }, token);
      if (!listingRes.ok) {
        setMessage({ type: "error", text: t("somethingWentWrong") });
        return;
      }
      const listing = await listingRes.json();

      // Attach every real photo/video already uploaded before submit.
      await Promise.all(media.map((m) => addListingPhoto(listing.id, m.url, m.media_type, token)));

      setMessage({ type: "success", text: t("success") });
    } catch {
      setMessage({ type: "error", text: t("couldNotReachServer") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="max-w-lg mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-[#1B2A4A] mb-2">{t("title")}</h1>
        <p className="text-gray-600 mb-6 text-sm">{t("description")}</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-gray-700">{t("neighborhoodLabel")}</label>
          <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded px-3 py-2" required>
            <option value="" disabled>{t("chooseNeighborhood")}</option>
            {quarters.map((q) => (
              <option key={q.id} value={q.id}>{q.name} ({q.village_name})</option>
            ))}
          </select>

          <label className="text-sm font-semibold text-gray-700">{t("bedroomsLabel")}</label>
          <input type="number" min={0} className="border rounded px-3 py-2" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />

          <label className="text-sm font-semibold text-gray-700">{t("descriptionLabel")}</label>
          <textarea rows={3} className="border rounded px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />

          <label className="text-sm font-semibold text-gray-700">{t("listingTypeLabel")}</label>
          <select value={listingType} onChange={(e) => setListingType(e.target.value)} className="border rounded px-3 py-2">
            <option value="RENT">{t("forRent")}</option>
            <option value="SALE">{t("forSale")}</option>
          </select>

          <label className="text-sm font-semibold text-gray-700">{t("priceLabel")}</label>
          <input
            type="number" required min={0} className="border rounded px-3 py-2"
            value={price} onChange={(e) => setPrice(e.target.value)}
          />

          <label className="text-sm font-semibold text-gray-700">{t("photosVideosLabel")}</label>
          <MediaUploader folder="listings" onUploaded={handleMediaUploaded} label={t("addPhotoOrVideo")} />
          {media.length > 0 && (
            <p className="text-xs text-gray-500">{t("mediaAttached", { count: media.length })}</p>
          )}

          {message && (
            <p className={message.type === "success" ? "text-green-700 text-sm" : "text-red-600 text-sm"}>
              {message.text}
            </p>
          )}
          {needsMfa && (
            <Link href="/mfa-setup" className="text-sm font-semibold text-[#1B2A4A] hover:text-[#C9A227] underline">
              {t("completeMfaSetup")} →
            </Link>
          )}

          <button type="submit" disabled={loading} className="bg-[#C9A227] text-[#1B2A4A] font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {loading ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>
    </main>
  );
}

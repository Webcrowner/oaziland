"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listQuarters, createHouse, createListing, addListingPhoto, setPropertyAmenities, setPropertyHouseRules, attachListingCondition, listPointsOfInterest, setNearbyFacilities, type Quarter, type MediaUploadResult, type PointOfInterest } from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";

const AMENITIES = [
  "PARKING", "BACKUP_GENERATOR", "BOREHOLE_WATER_TANK", "SECURITY_24_7", "FENCED_COMPOUND",
  "SWIMMING_POOL", "AIR_CONDITIONING", "FURNISHED", "SOLAR_POWER", "CCTV", "BALCONY_TERRACE", "WIFI_READY",
] as const;
const HOUSE_RULES = [
  "NO_PETS", "NO_SMOKING_INDOORS", "NO_SUBLETTING", "NO_PARTIES", "QUIET_HOURS_AFTER_10PM", "ADVANCE_NOTICE_FOR_VISITS",
] as const;
// Mirrors the real backend HouseStyle choices exactly — OTHER pairs
// with a free-text field below so a lister is never blocked by an
// incomplete list, per the founder's own explicit request.
const HOUSE_TYPES = [
  "ROOM", "STUDIO", "SELF_CONTAIN", "APARTMENT", "STANDARD", "DUPLEX", "BUNGALOW", "DETACHED_VILLA", "CHALET", "OTHER",
] as const;

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
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [houseType, setHouseType] = useState<string>("STANDARD");
  const [customHouseType, setCustomHouseType] = useState("");
  const [pointsOfInterest, setPointsOfInterest] = useState<PointOfInterest[]>([]);
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [minLeaseMonths, setMinLeaseMonths] = useState("");
  const [depositRequired, setDepositRequired] = useState(false);
  const [conditionsNotes, setConditionsNotes] = useState("");
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

  // Real nearby facilities are quarter-specific — a lister only ever
  // needs to see the real points of interest near THEIR neighborhood,
  // refetched whenever they change the selected quarter.
  useEffect(() => {
    if (!quarterId) return;
    listPointsOfInterest(quarterId).then(setPointsOfInterest).catch(() => setPointsOfInterest([]));
    setSelectedFacilities([]);
  }, [quarterId]);

  function handleMediaUploaded(result: MediaUploadResult) {
    setMedia((prev) => [...prev, result]);
  }

  function toggleAmenity(value: string) {
    setSelectedAmenities((prev) => (prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]));
  }

  function toggleRule(value: string) {
    setSelectedRules((prev) => (prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]));
  }

  function toggleFacility(value: string) {
    setSelectedFacilities((prev) => (prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]));
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
        {
          quarter: quarterId, bedrooms: bedrooms ? Number(bedrooms) : undefined, description: description || undefined,
          house_style: houseType, custom_house_style: houseType === "OTHER" ? customHouseType : undefined,
        },
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

      if (selectedAmenities.length > 0) {
        await setPropertyAmenities("HOUSE", house.id, selectedAmenities, token).catch(() => {});
      }
      if (selectedRules.length > 0) {
        await setPropertyHouseRules("HOUSE", house.id, selectedRules, token).catch(() => {});
      }
      if (selectedFacilities.length > 0) {
        await setNearbyFacilities("HOUSE", house.id, selectedFacilities, token).catch(() => {});
      }

      const listingRes = await createListing({ property_asset_id: house.id, listing_type: listingType, price_xaf: price }, token);
      if (!listingRes.ok) {
        setMessage({ type: "error", text: t("somethingWentWrong") });
        return;
      }
      const listing = await listingRes.json();

      // Real conditions/rules — attaching only if the lister actually
      // specified something, since an empty condition set is
      // meaningless noise, not a real rule worth recording.
      if (minLeaseMonths || depositRequired || conditionsNotes) {
        const structuredConditions: Record<string, unknown> = {};
        if (minLeaseMonths) structuredConditions.min_lease_months = Number(minLeaseMonths);
        if (depositRequired) structuredConditions.deposit_required = true;
        await attachListingCondition({
          target_content_type: "property.Listing", target_id: listing.id,
          structured_conditions: structuredConditions, free_text_clause: conditionsNotes,
        }, token).catch(() => {});
      }

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

          <label className="text-sm font-semibold text-gray-700">{t("houseTypeLabel")}</label>
          <select value={houseType} onChange={(e) => setHouseType(e.target.value)} className="border rounded px-3 py-2">
            {HOUSE_TYPES.map((type) => <option key={type} value={type}>{t(`houseType_${type}`)}</option>)}
          </select>
          {houseType === "OTHER" && (
            <input
              required placeholder={t("customHouseTypePlaceholder")} value={customHouseType}
              onChange={(e) => setCustomHouseType(e.target.value)} className="border rounded px-3 py-2"
            />
          )}

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

          <label className="text-sm font-semibold text-gray-700 mt-2">{t("amenitiesLabel")}</label>
          <div className="grid grid-cols-2 gap-2">
            {AMENITIES.map((amenity) => (
              <label key={amenity} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={selectedAmenities.includes(amenity)} onChange={() => toggleAmenity(amenity)} />
                {t(`amenity_${amenity}`)}
              </label>
            ))}
          </div>

          <label className="text-sm font-semibold text-gray-700 mt-2">{t("houseRulesLabel")}</label>
          <div className="grid grid-cols-2 gap-2">
            {HOUSE_RULES.map((rule) => (
              <label key={rule} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={selectedRules.includes(rule)} onChange={() => toggleRule(rule)} />
                {t(`rule_${rule}`)}
              </label>
            ))}
          </div>

          {pointsOfInterest.length > 0 && (
            <>
              <label className="text-sm font-semibold text-gray-700 mt-2">{t("nearbyFacilitiesLabel")}</label>
              <div className="grid grid-cols-2 gap-2">
                {pointsOfInterest.map((poi) => (
                  <label key={poi.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={selectedFacilities.includes(poi.id)} onChange={() => toggleFacility(poi.id)} />
                    {poi.name} ({poi.poi_type_display})
                  </label>
                ))}
              </div>
            </>
          )}

          <label className="text-sm font-semibold text-gray-700 mt-2">{t("conditionsLabel")}</label>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-gray-500">{t("minLeaseMonthsLabel")}</label>
              <input type="number" min={0} className="border rounded px-3 py-2 w-full" value={minLeaseMonths} onChange={(e) => setMinLeaseMonths(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-4">
              <input type="checkbox" checked={depositRequired} onChange={(e) => setDepositRequired(e.target.checked)} />
              {t("depositRequiredLabel")}
            </label>
          </div>
          <textarea
            rows={2} placeholder={t("conditionsNotesPlaceholder")} className="border rounded px-3 py-2"
            value={conditionsNotes} onChange={(e) => setConditionsNotes(e.target.value)}
          />

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

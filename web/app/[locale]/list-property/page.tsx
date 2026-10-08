"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import {
  listQuarters,
  createHouse,
  createShop,
  createLand,
  createListing,
  addListingPhoto,
  setPropertyAmenities,
  setPropertyHouseRules,
  attachListingCondition,
  listPointsOfInterest,
  setNearbyFacilities,
  type Quarter,
  type MediaUploadResult,
  type PointOfInterest,
} from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";
import LocationCapture from "@/components/LocationCapture";
import {
  IconHome,
  IconBuilding,
  IconMapPin,
  IconCheckCircle,
  IconShield,
  IconShieldCheck,
  IconAlertCircle,
  IconTrash,
  IconSparkles,
  IconLock,
  IconChevronRight,
  IconBed,
  IconBath,
  IconArea,
} from "@/components/Icons";

const PROPERTY_TYPES = ["HOUSE", "LAND", "SHOP"] as const;
const LAND_USE_TYPES = [
  "TITLED_RESIDENTIAL",
  "COMMERCIAL_PLOT",
  "AGRICULTURAL",
  "CAR_WASH_PAVED_PLOT",
] as const;
const TITLE_TYPES = ["TITRE_FONCIER", "CONCESSION", "DEMANDE_EN_COURS"] as const;

const AMENITIES = [
  "PARKING",
  "BACKUP_GENERATOR",
  "BOREHOLE_WATER_TANK",
  "SECURITY_24_7",
  "FENCED_COMPOUND",
  "SWIMMING_POOL",
  "AIR_CONDITIONING",
  "FURNISHED",
  "SOLAR_POWER",
  "CCTV",
  "BALCONY_TERRACE",
  "WIFI_READY",
] as const;

const HOUSE_RULES = [
  "NO_PETS",
  "NO_SMOKING_INDOORS",
  "NO_SUBLETTING",
  "NO_PARTIES",
  "QUIET_HOURS_AFTER_10PM",
  "ADVANCE_NOTICE_FOR_VISITS",
] as const;

const HOUSE_TYPES = [
  "ROOM",
  "STUDIO",
  "SELF_CONTAIN",
  "APARTMENT",
  "STANDARD",
  "DUPLEX",
  "BUNGALOW",
  "DETACHED_VILLA",
  "CHALET",
  "OTHER",
] as const;

export default function ListPropertyPage() {
  const t = useTranslations("ListPropertyPage");
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [quarterId, setQuarterId] = useState("");
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [propertyType, setPropertyType] = useState<(typeof PROPERTY_TYPES)[number]>("HOUSE");
  const [houseType, setHouseType] = useState<string>("STANDARD");
  const [customHouseType, setCustomHouseType] = useState("");
  const [pointsOfInterest, setPointsOfInterest] = useState<PointOfInterest[]>([]);
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [minLeaseMonths, setMinLeaseMonths] = useState("");
  const [depositRequired, setDepositRequired] = useState(false);
  const [conditionsNotes, setConditionsNotes] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [livingRooms, setLivingRooms] = useState("");
  const [sizeSqm, setSizeSqm] = useState("");
  const [description, setDescription] = useState("");
  const [listingType, setListingType] = useState<"RENT" | "SALE">("RENT");
  const [price, setPrice] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [needsKyc, setNeedsKyc] = useState(false);
  const [loading, setLoading] = useState(false);

  // Shop-specific
  const [frontageMeters, setFrontageMeters] = useState("");

  // Land-specific
  const [landUseType, setLandUseType] = useState<string>("TITLED_RESIDENTIAL");
  const [titleType, setTitleType] = useState<string>("TITRE_FONCIER");
  const [titleDeedNumber, setTitleDeedNumber] = useState("");
  const [bornesVisibles, setBornesVisibles] = useState(false);

  // Real GPS Coordinates captured on-site
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });

  useEffect(() => {
    listQuarters()
      .then((data) => {
        setQuarters(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!quarterId) return;
    listPointsOfInterest(quarterId)
      .then(setPointsOfInterest)
      .catch(() => setPointsOfInterest([]));
    setSelectedFacilities([]);
  }, [quarterId]);

  function handleMediaUploaded(result: MediaUploadResult) {
    setMedia((prev) => [...prev, result]);
  }

  function handleRemoveMedia(index: number) {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleAmenity(value: string) {
    setSelectedAmenities((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]
    );
  }

  function toggleRule(value: string) {
    setSelectedRules((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]
    );
  }

  function toggleFacility(value: string) {
    setSelectedFacilities((prev) =>
      prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]
    );
  }

  function canProceedFromStep(step: number): { ok: boolean; error?: string } {
    if (step === 1) {
      if (propertyType === "HOUSE" && houseType === "OTHER" && !customHouseType.trim()) {
        return { ok: false, error: t("customHouseTypePlaceholder") };
      }
      return { ok: true };
    }
    if (step === 2) {
      if (!quarterId) {
        return { ok: false, error: t("chooseNeighborhoodError") };
      }
      if (propertyType === "LAND" && !titleDeedNumber.trim()) {
        return { ok: false, error: t("titleDeedRequiredError") };
      }
      return { ok: true };
    }
    if (step === 3) {
      if (!price || Number(price) <= 0) {
        return { ok: false, error: t("priceLabel") };
      }
      return { ok: true };
    }
    return { ok: true };
  }

  function handleNextStep() {
    setMessage(null);
    const check = canProceedFromStep(currentStep);
    if (!check.ok) {
      setMessage({ type: "error", text: check.error || t("somethingWentWrong") });
      return;
    }
    if (currentStep < 4) {
      setCurrentStep((prev) => (prev + 1) as 1 | 2 | 3 | 4);
    }
  }

  function handlePrevStep() {
    setMessage(null);
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as 1 | 2 | 3 | 4);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setNeedsKyc(false);

    const step2Check = canProceedFromStep(2);
    if (!step2Check.ok) {
      setCurrentStep(2);
      setMessage({ type: "error", text: step2Check.error || t("somethingWentWrong") });
      return;
    }

    const step3Check = canProceedFromStep(3);
    if (!step3Check.ok) {
      setCurrentStep(3);
      setMessage({ type: "error", text: step3Check.error || t("somethingWentWrong") });
      return;
    }

    setLoading(true);

    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setMessage({ type: "error", text: t("signInFirst") });
      setLoading(false);
      return;
    }

    try {
      let assetRes: Response;
      if (propertyType === "HOUSE") {
        assetRes = await createHouse(
          {
            quarter: quarterId,
            size_sqm: sizeSqm || undefined,
            bedrooms: bedrooms ? Number(bedrooms) : undefined,
            bathrooms: bathrooms ? Number(bathrooms) : undefined,
            living_rooms: livingRooms ? Number(livingRooms) : undefined,
            description: description || undefined,
            house_style: houseType,
            custom_house_style: houseType === "OTHER" ? customHouseType : undefined,
            latitude: gpsCoords.latitude ?? undefined,
            longitude: gpsCoords.longitude ?? undefined,
          },
          token
        );
      } else if (propertyType === "SHOP") {
        assetRes = await createShop(
          {
            quarter: quarterId,
            size_sqm: sizeSqm || undefined,
            description: description || undefined,
            frontage_meters: frontageMeters || undefined,
            latitude: gpsCoords.latitude ?? undefined,
            longitude: gpsCoords.longitude ?? undefined,
          },
          token
        );
      } else {
        assetRes = await createLand(
          {
            quarter: quarterId,
            size_sqm: sizeSqm || undefined,
            description: description || undefined,
            land_use_type: landUseType,
            title_type: titleType,
            title_deed_number: titleDeedNumber,
            bornes_visibles: bornesVisibles,
            latitude: gpsCoords.latitude ?? undefined,
            longitude: gpsCoords.longitude ?? undefined,
          },
          token
        );
      }

      if (assetRes.status === 403) {
        // Defensive fallback only — creating the bare asset no longer
        // requires KYC (deferred to the listing/"publish" step below),
        // so this shouldn't normally trigger.
        setMessage({ type: "error", text: t("kycRequired") });
        setNeedsKyc(true);
        setLoading(false);
        return;
      }
      if (!assetRes.ok) {
        setMessage({ type: "error", text: t("somethingWentWrong") });
        setLoading(false);
        return;
      }
      const asset = await assetRes.json();

      if (selectedAmenities.length > 0) {
        await setPropertyAmenities(propertyType, asset.id, selectedAmenities, token).catch(() => {});
      }
      if (selectedRules.length > 0) {
        await setPropertyHouseRules(propertyType, asset.id, selectedRules, token).catch(() => {});
      }
      if (selectedFacilities.length > 0) {
        await setNearbyFacilities(propertyType, asset.id, selectedFacilities, token).catch(() => {});
      }

      const listingRes = await createListing(
        { property_asset_id: asset.id, listing_type: listingType, price_xaf: price },
        token
      );
      if (listingRes.status === 403) {
        // The real gate: publishing (creating the Listing) is where
        // KYC is actually enforced platform-wide — MFA is no longer
        // required anywhere, just an optional feature in account settings.
        setMessage({ type: "error", text: t("kycRequired") });
        setNeedsKyc(true);
        setLoading(false);
        return;
      }
      if (!listingRes.ok) {
        setMessage({ type: "error", text: t("somethingWentWrong") });
        setLoading(false);
        return;
      }
      const listing = await listingRes.json();

      if (minLeaseMonths || depositRequired || conditionsNotes) {
        const structuredConditions: Record<string, unknown> = {};
        if (minLeaseMonths) structuredConditions.min_lease_months = Number(minLeaseMonths);
        if (depositRequired) structuredConditions.deposit_required = true;
        await attachListingCondition(
          {
            target_content_type: "property.Listing",
            target_id: listing.id,
            structured_conditions: structuredConditions,
            free_text_clause: conditionsNotes,
          },
          token
        ).catch(() => {});
      }

      for (const m of media) {
        await addListingPhoto(listing.id, m.url, m.media_type, token);
      }

      setMessage({ type: "success", text: t("success") });
    } catch {
      setMessage({ type: "error", text: t("couldNotReachServer") });
    } finally {
      setLoading(false);
    }
  }

  const stepsInfo = [
    { num: 1, title: t("step1Title"), desc: t("step1Desc") },
    { num: 2, title: t("step2Title"), desc: t("step2Desc") },
    { num: 3, title: t("step3Title"), desc: t("step3Desc") },
    { num: 4, title: t("step4Title"), desc: t("step4Desc") },
  ];

  const selectedQuarterObj = quarters.find((q) => q.id === quarterId);

  return (
    <main className="min-h-screen bg-slate-50/70 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Top Hero Banner */}
        <div className="mb-8 rounded-3xl bg-gradient-to-r from-slate-900 via-slate-850 to-slate-950 p-6 sm:p-8 text-white shadow-xl shadow-slate-950/15 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-64 h-64 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-amber-300 text-xs font-bold uppercase tracking-wider mb-3">
                <IconSparkles size={14} />
                <span>Verified Landlord &amp; Owner Portal</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                {t("title")}
              </h1>
              <p className="mt-1.5 text-sm text-slate-300 max-w-xl leading-relaxed">
                {t("description")}
              </p>
            </div>

            <div className="flex items-center gap-3 self-start md:self-auto bg-slate-800/80 border border-slate-700/80 px-4 py-2.5 rounded-2xl shadow-inner">
              <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black">
                <IconShieldCheck size={18} />
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-tight">Title-Guaranteed</p>
                <p className="text-[11px] text-slate-400">Zero duplicate fraud</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stepper Navigation */}
        <div className="mb-8 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stepsInfo.map((s) => {
              const isCurrent = currentStep === s.num;
              const isDone = currentStep > s.num;
              return (
                <button
                  type="button"
                  key={s.num}
                  onClick={() => {
                    if (s.num < currentStep) setCurrentStep(s.num as 1 | 2 | 3 | 4);
                    else if (s.num > currentStep) {
                      const check = canProceedFromStep(currentStep);
                      if (check.ok) setCurrentStep(s.num as 1 | 2 | 3 | 4);
                    }
                  }}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
                    isCurrent
                      ? "bg-slate-900 text-white shadow-md shadow-slate-900/10"
                      : isDone
                      ? "bg-emerald-50 text-emerald-950 border border-emerald-200/70"
                      : "bg-slate-50/80 text-slate-500 hover:bg-slate-100/70 border border-transparent"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                      isCurrent
                        ? "bg-amber-400 text-slate-950"
                        : isDone
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {isDone ? <IconCheckCircle size={14} /> : s.num}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-bold truncate ${isCurrent ? "text-white" : isDone ? "text-emerald-900" : "text-slate-800"}`}>
                      {s.title}
                    </p>
                    <p className={`text-[10px] truncate hidden sm:block ${isCurrent ? "text-slate-300" : isDone ? "text-emerald-700" : "text-slate-400"}`}>
                      {s.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form Body + Live Summary Split Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Main Form Box (8 cols) */}
          <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-6">

              {/* STEP 1: ASSET & CATEGORY */}
              {currentStep === 1 && (
                <div className="space-y-6 animate-rise-in">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>{t("step1Title")}</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">{t("choosePropertyTypeHint")}</p>
                  </div>

                  {/* Property Type Selector */}
                  <div className="grid grid-cols-3 gap-3">
                    {PROPERTY_TYPES.map((pt) => {
                      const isSelected = propertyType === pt;
                      const Icon = pt === "HOUSE" ? IconHome : pt === "SHOP" ? IconBuilding : IconArea;
                      return (
                        <button
                          key={pt}
                          type="button"
                          onClick={() => setPropertyType(pt)}
                          className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${
                            isSelected
                              ? "border-slate-900 bg-slate-900 text-white shadow-md shadow-slate-900/10"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2 ${
                            isSelected ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-600"
                          }`}>
                            <Icon size={20} />
                          </div>
                          <span className="text-xs sm:text-sm font-bold tracking-tight">
                            {t(`propertyType_${pt}`)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* House Styles */}
                  {propertyType === "HOUSE" && (
                    <div className="space-y-3 pt-2">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                        {t("houseTypeLabel")}
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {HOUSE_TYPES.map((type) => {
                          const isSelected = houseType === type;
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setHouseType(type)}
                              className={`px-3 py-2.5 rounded-xl text-xs font-bold border transition-all text-left ${
                                isSelected
                                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                              }`}
                            >
                              {t(`houseType_${type}`)}
                            </button>
                          );
                        })}
                      </div>

                      {houseType === "OTHER" && (
                        <div className="pt-2">
                          <label className="text-xs font-semibold text-slate-600 block mb-1">
                            {t("customHouseTypePlaceholder")}
                          </label>
                          <input
                            type="text"
                            required
                            placeholder={t("customHouseTypePlaceholder")}
                            value={customHouseType}
                            onChange={(e) => setCustomHouseType(e.target.value)}
                            className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Land Classification */}
                  {propertyType === "LAND" && (
                    <div className="space-y-3 pt-2">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                        {t("landUseTypeLabel")}
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {LAND_USE_TYPES.map((type) => {
                          const isSelected = landUseType === type;
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setLandUseType(type)}
                              className={`p-3 rounded-xl text-xs font-bold border transition-all text-left ${
                                isSelected
                                  ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                              }`}
                            >
                              {t(`landUseType_${type}`)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2: LOCATION & SPECS */}
              {currentStep === 2 && (
                <div className="space-y-6 animate-rise-in">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>{t("step2Title")}</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">{t("step2Desc")}</p>
                  </div>

                  {/* Neighborhood Selector */}
                  <div>
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                      {t("neighborhoodLabel")}
                    </label>
                    <div className="relative">
                      <select
                        value={quarterId}
                        onChange={(e) => setQuarterId(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                        required
                      >
                        <option value="" disabled>
                          {t("chooseNeighborhood")}
                        </option>
                        <QuarterOptions quarters={quarters} />
                      </select>
                    </div>
                    <MissingAreaRequest quarters={quarters} className="mt-2" />
                  </div>

                  {/* Real GPS Location Capture on Site */}
                  <LocationCapture value={gpsCoords} onChange={setGpsCoords} />

                  {/* Physical Dimensions */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                        {t("sizeSqmLabel")}
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          placeholder="e.g. 180"
                          className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                          value={sizeSqm}
                          onChange={(e) => setSizeSqm(e.target.value)}
                        />
                        <span className="absolute right-3.5 top-2.5 text-xs text-slate-400 font-bold">m²</span>
                      </div>
                    </div>

                    {propertyType === "HOUSE" && (
                      <>
                        <div>
                          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                            {t("bedroomsLabel")}
                          </label>
                          <input
                            type="number"
                            min={0}
                            placeholder="e.g. 3"
                            className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                            value={bedrooms}
                            onChange={(e) => setBedrooms(e.target.value)}
                          />
                        </div>

                        <div>
                          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                            {t("bathroomsLabel")}
                          </label>
                          <input
                            type="number"
                            min={0}
                            placeholder="e.g. 2"
                            className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                            value={bathrooms}
                            onChange={(e) => setBathrooms(e.target.value)}
                          />
                        </div>

                        <div>
                          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                            {t("livingRoomsLabel")}
                          </label>
                          <input
                            type="number"
                            min={0}
                            placeholder="e.g. 1"
                            className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                            value={livingRooms}
                            onChange={(e) => setLivingRooms(e.target.value)}
                          />
                        </div>
                      </>
                    )}

                    {propertyType === "SHOP" && (
                      <div className="sm:col-span-2">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                          {t("frontageMetersLabel")}
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            placeholder="e.g. 12"
                            className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                            value={frontageMeters}
                            onChange={(e) => setFrontageMeters(e.target.value)}
                          />
                          <span className="absolute right-3.5 top-2.5 text-xs text-slate-400 font-bold">meters</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Land Title Specific Verification Fields */}
                  {propertyType === "LAND" && (
                    <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 space-y-4">
                      <div className="flex items-center gap-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
                        <IconShieldCheck size={16} />
                        <span>Land Title Registry &amp; Cadastral Verification</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                            {t("titleTypeLabel")}
                          </label>
                          <select
                            value={titleType}
                            onChange={(e) => setTitleType(e.target.value)}
                            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-white"
                          >
                            {TITLE_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {t(`titleType_${type}`)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                            {t("titleDeedNumberLabel")} *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder={t("titleDeedNumberPlaceholder")}
                            value={titleDeedNumber}
                            onChange={(e) => setTitleDeedNumber(e.target.value)}
                            className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                          />
                        </div>
                      </div>

                      <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-800 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={bornesVisibles}
                          onChange={(e) => setBornesVisibles(e.target.checked)}
                          className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300"
                        />
                        <span>{t("bornesVisiblesLabel")}</span>
                      </label>
                    </div>
                  )}

                  {/* Narrative Description */}
                  <div>
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                      {t("descriptionLabel")}
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Describe the highlights, road accessibility, security, and compound arrangement..."
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* STEP 3: PRICING & MEDIA */}
              {currentStep === 3 && (
                <div className="space-y-6 animate-rise-in">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>{t("step3Title")}</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">{t("step3Desc")}</p>
                  </div>

                  {/* Rent vs Sale toggle */}
                  <div>
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                      {t("listingTypeLabel")}
                    </label>
                    <div className="grid grid-cols-2 gap-3 max-w-sm">
                      {(["RENT", "SALE"] as const).map((mode) => {
                        const isSelected = listingType === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setListingType(mode)}
                            className={`py-2.5 px-4 rounded-xl text-xs font-extrabold transition-all border ${
                              isSelected
                                ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            {mode === "RENT" ? t("forRent") : t("forSale")}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Price input */}
                  <div>
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                      {t("priceLabel")} *
                    </label>
                    <div className="relative max-w-md">
                      <input
                        type="number"
                        required
                        min={0}
                        placeholder="e.g. 150000"
                        className="w-full px-4 py-3 text-base font-extrabold rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all text-slate-900"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                      <span className="absolute right-4 top-3 text-xs font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
                        XAF {listingType === "RENT" ? "/ month" : ""}
                      </span>
                    </div>
                  </div>

                  {/* Media Uploader Section */}
                  <div className="p-5 rounded-2xl bg-slate-50/80 border border-slate-200/90 space-y-4">
                    <div>
                      <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block mb-1">
                        {t("photosVideosLabel")}
                      </label>
                      <p className="text-xs text-slate-500 leading-relaxed mb-3">
                        {t("photosHint")}
                      </p>
                      <MediaUploader
                        folder="listings"
                        onUploaded={handleMediaUploaded}
                        label={t("addPhotoOrVideo")}
                      />
                    </div>

                    {/* Media preview chips */}
                    {media.length > 0 && (
                      <div className="space-y-2 pt-2">
                        <p className="text-xs font-bold text-slate-700">
                          {t("mediaAttached", { count: media.length })}
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                          {media.map((item, idx) => (
                            <div
                              key={idx}
                              className="group relative rounded-xl border border-slate-200 overflow-hidden bg-white p-1.5 shadow-xs flex items-center justify-between"
                            >
                              <div className="min-w-0 pr-2">
                                <p className="text-[11px] font-bold text-slate-800 truncate">
                                  {item.media_type === "VIDEO" ? "Walkthrough Video" : `Photo #${idx + 1}`}
                                </p>
                                <span className="text-[9px] uppercase font-semibold text-slate-400">
                                  {item.media_type}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveMedia(idx)}
                                className="w-6 h-6 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center shrink-0 transition-colors"
                                title={t("removeMedia")}
                              >
                                <IconTrash size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 4: AMENITIES, RULES & LEASE */}
              {currentStep === 4 && (
                <div className="space-y-6 animate-rise-in">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>{t("step4Title")}</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">{t("step4Desc")}</p>
                  </div>

                  {/* Amenities */}
                  <div>
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
                      {t("amenitiesLabel")}
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {AMENITIES.map((amenity) => {
                        const isChecked = selectedAmenities.includes(amenity);
                        return (
                          <button
                            key={amenity}
                            type="button"
                            onClick={() => toggleAmenity(amenity)}
                            className={`flex items-center gap-2.5 p-2.5 rounded-xl text-xs font-bold border transition-all text-left ${
                              isChecked
                                ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border text-[10px] ${
                                isChecked
                                  ? "bg-amber-400 text-slate-950 border-amber-400"
                                  : "border-slate-300 bg-white"
                              }`}
                            >
                              {isChecked ? "✓" : ""}
                            </span>
                            <span className="truncate">{t(`amenity_${amenity}`)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* House Rules */}
                  <div>
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
                      {t("houseRulesLabel")}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {HOUSE_RULES.map((rule) => {
                        const isChecked = selectedRules.includes(rule);
                        return (
                          <button
                            key={rule}
                            type="button"
                            onClick={() => toggleRule(rule)}
                            className={`flex items-center gap-2.5 p-2.5 rounded-xl text-xs font-bold border transition-all text-left ${
                              isChecked
                                ? "bg-amber-50 text-amber-900 border-amber-300"
                                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border text-[10px] ${
                                isChecked
                                  ? "bg-amber-600 text-white border-amber-600"
                                  : "border-slate-300 bg-white"
                              }`}
                            >
                              {isChecked ? "✓" : ""}
                            </span>
                            <span className="truncate">{t(`rule_${rule}`)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Nearby Facilities (if any points of interest exist) */}
                  {pointsOfInterest.length > 0 && (
                    <div>
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
                        {t("nearbyFacilitiesLabel")}
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {pointsOfInterest.map((poi) => {
                          const isChecked = selectedFacilities.includes(poi.id);
                          return (
                            <button
                              key={poi.id}
                              type="button"
                              onClick={() => toggleFacility(poi.id)}
                              className={`flex items-center gap-2.5 p-2.5 rounded-xl text-xs font-semibold border transition-all text-left ${
                                isChecked
                                  ? "bg-indigo-50 text-indigo-950 border-indigo-300"
                                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                              }`}
                            >
                              <span
                                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border text-[10px] ${
                                  isChecked
                                    ? "bg-indigo-600 text-white border-indigo-600"
                                    : "border-slate-300 bg-white"
                                }`}
                              >
                                {isChecked ? "✓" : ""}
                              </span>
                              <span className="truncate">
                                {poi.name} ({poi.poi_type_display})
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Conditions & Structured Lease */}
                  <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/90 space-y-4">
                    <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                      {t("conditionsLabel")}
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-600 block mb-1">
                          {t("minLeaseMonthsLabel")}
                        </label>
                        <input
                          type="number"
                          min={0}
                          placeholder="e.g. 6"
                          className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-white"
                          value={minLeaseMonths}
                          onChange={(e) => setMinLeaseMonths(e.target.value)}
                        />
                      </div>

                      <div className="flex items-center pt-5">
                        <label className="flex items-center gap-2.5 text-xs font-bold text-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={depositRequired}
                            onChange={(e) => setDepositRequired(e.target.checked)}
                            className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300"
                          />
                          <span>{t("depositRequiredLabel")}</span>
                        </label>
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      placeholder={t("conditionsNotesPlaceholder")}
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      value={conditionsNotes}
                      onChange={(e) => setConditionsNotes(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Status / Error Messages */}
              {message && (
                <div
                  className={`p-4 rounded-2xl text-xs sm:text-sm font-semibold flex items-center gap-2.5 ${
                    message.type === "success"
                      ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                      : "bg-rose-50 text-rose-900 border border-rose-200"
                  }`}
                >
                  {message.type === "success" ? (
                    <IconCheckCircle size={18} className="text-emerald-600 shrink-0" />
                  ) : (
                    <IconAlertCircle size={18} className="text-rose-600 shrink-0" />
                  )}
                  <span>{message.text}</span>
                </div>
              )}

              {needsKyc && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs sm:text-sm">
                  <p className="font-bold text-amber-900 mb-2">Security Verification Required</p>
                  <Link
                    href="/kyc"
                    className="inline-flex items-center gap-1.5 font-bold text-amber-800 hover:text-amber-950 underline"
                  >
                    <span>{t("completeKycVerification")}</span>
                    <IconChevronRight size={14} />
                  </Link>
                </div>
              )}

              {/* Navigation Actions */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
                {currentStep > 1 ? (
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    ← {t("prevStep")}
                  </button>
                ) : (
                  <span />
                )}

                {currentStep < 4 ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-md shadow-slate-900/10 transition-all flex items-center gap-1.5"
                  >
                    <span>{t("nextStep")}</span>
                    <IconChevronRight size={14} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-8 py-3 rounded-xl text-xs sm:text-sm font-extrabold bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 shadow-lg shadow-amber-400/25 transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    <IconCheckCircle size={16} />
                    <span>{loading ? t("submitting") : t("submit")}</span>
                  </button>
                )}
              </div>

            </form>
          </div>

          {/* Right Live Preview Card (4 cols) */}
          <div className="lg:col-span-4 space-y-5 sticky top-24">
            
            {/* Live Property Snapshot Card */}
            <div className="bg-white border border-slate-200/90 rounded-3xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Live Preview Snapshot
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                  Draft
                </span>
              </div>

              {/* Photo placeholder or attached counter */}
              <div className="h-36 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center p-4 text-center border border-slate-200/80">
                {media.length > 0 ? (
                  <div className="space-y-1">
                    <div className="w-10 h-10 rounded-full bg-white text-slate-900 flex items-center justify-center mx-auto shadow-sm font-bold text-xs">
                      {media.length}
                    </div>
                    <p className="text-xs font-bold text-slate-800">
                      {media.length} Media Uploaded
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1 text-slate-400">
                    <IconHome size={28} className="mx-auto text-slate-300" />
                    <p className="text-xs font-medium">No media uploaded yet</p>
                  </div>
                )}
              </div>

              {/* Title & Specs */}
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-black text-slate-900">
                    {price ? `${Number(price).toLocaleString()} XAF` : "Price pending"}
                  </span>
                  <span className="text-xs font-bold text-slate-500">
                    {listingType === "RENT" ? "/ month" : "outright"}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-700 mt-1">
                  {propertyType === "HOUSE"
                    ? `${t(`houseType_${houseType}`)} • House`
                    : propertyType === "LAND"
                    ? `${t(`landUseType_${landUseType}`)} • Land`
                    : "Commercial Retail Shop"}
                </p>
                <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                  <IconMapPin size={12} className="text-amber-500" />
                  <span>
                    {selectedQuarterObj ? `${selectedQuarterObj.name}, ${selectedQuarterObj.village_name}` : "Neighborhood pending"}
                  </span>
                </p>
              </div>

              {/* Feature Pills */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {sizeSqm && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 flex items-center gap-1">
                    <IconArea size={10} />
                    <span>{sizeSqm} m²</span>
                  </span>
                )}
                {bedrooms && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 flex items-center gap-1">
                    <IconBed size={10} />
                    <span>{bedrooms} beds</span>
                  </span>
                )}
                {bathrooms && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 flex items-center gap-1">
                    <IconBath size={10} />
                    <span>{bathrooms} baths</span>
                  </span>
                )}
              </div>
            </div>

            {/* Compliance & Trust Card */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 text-white shadow-md space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                <IconShield size={14} />
                <span>Verification Policy</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {t("draftReviewNotice")}
              </p>
            </div>

          </div>

        </div>

      </div>
    </main>
  );
}

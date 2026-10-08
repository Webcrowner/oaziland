"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { searchGuestHouses, createGuestHouse, addGuestHousePhoto, listQuarters, type GuestHouse, type Quarter, type MediaUploadResult } from "@/lib/api";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import PageHeader from "@/components/ui/PageHeader";
import AssetCard from "@/components/AssetCard";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import LocationCapture, { EMPTY_GPS, type GpsValue } from "@/components/LocationCapture";
import MediaThumbs from "@/components/MediaThumbs";
import DirectChatButton from "@/components/DirectChatButton";
import { Link } from "@/i18n/navigation";
import InterestCaptureModal from "@/components/InterestCaptureModal";
import {
  IconHome,
  IconMapPin,
  IconShieldCheck,
  IconLock,
  IconClock,
  IconSparkles,
} from "@/components/Icons";

const SHOWCASE_GUEST_HOUSES = [
  {
    id: "showcase-gh1",
    name: "Kribi Beachfront Palm Villa",
    quarter_name: "Kribi Beachfront, South",
    is_coastal: true,
    finish_level: "MODERN",
    rate_xaf: "60,000",
    unit_label: "per night",
    photo_url: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=800&q=80",
    amenities: ["Private Swimming Pool", "Beachfront Deck", "Generator Backup", "Housekeeper Included"],
  },
  {
    id: "showcase-gh2",
    name: "Bastos Executive Furnished Duplex",
    quarter_name: "Bastos, Yaoundé",
    is_coastal: false,
    finish_level: "MODERN",
    rate_xaf: "50,000",
    unit_label: "per night",
    photo_url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
    amenities: ["Gourmet Kitchen", "High-Speed WiFi", "24/7 Security", "Borehole Water"],
  },
  {
    id: "showcase-gh3",
    name: "Bonapriso Contemporary Flat",
    quarter_name: "Bonapriso, Douala",
    is_coastal: false,
    finish_level: "MODERN",
    rate_xaf: "45,000",
    unit_label: "per night",
    photo_url: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80",
    amenities: ["Balcony Terrace", "Smart TV & Streaming", "Industrial AC", "Free Secure Parking"],
  },
  {
    id: "showcase-gh4",
    name: "Limbe Sea Breeze Cottage",
    quarter_name: "Limbe Coast, South-West",
    is_coastal: true,
    finish_level: "STANDARD",
    rate_xaf: "35,000",
    unit_label: "per night",
    photo_url: "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=800&q=80",
    amenities: ["Ocean View Terrace", "Barbecue Grill", "Solar Water Heating", "Close to Down Beach"],
  },
];

export default function GuestHousesPage() {
  const t = useTranslations("GuestHousesPage");
  const [guestHouses, setGuestHouses] = useState<GuestHouse[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

  // Filter states
  const [filterQuarter, setFilterQuarter] = useState("");
  const [filterCoastalOnly, setFilterCoastalOnly] = useState(false);

  // Form states
  const [quarterId, setQuarterId] = useState("");
  const [isCoastalLeisure, setIsCoastalLeisure] = useState(false);
  const [finishLevel, setFinishLevel] = useState("STANDARD");
  const [gpsCoords, setGpsCoords] = useState<GpsValue>(EMPTY_GPS);
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  // Customer-facing lead capture on showcase (preview) cards - these
  // aren't real bookable stays yet, so the primary card action must
  // speak to a guest, not a property owner.
  const [interestItem, setInterestItem] = useState<string | null>(null);

  const load = useCallback(() => {
    searchGuestHouses()
      .then((data) => setGuestHouses(data.results))
      .catch(() => setGuestHouses([]))
      .finally(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    load();
    // Shared/chatbot links can preselect the area (?quarter=<id>).
    const presetQuarter = new URLSearchParams(window.location.search).get("quarter");
    if (presetQuarter) setFilterQuarter(presetQuarter);
    listQuarters()
      .then((data) => {
        setQuarters(data);
      })
      .catch(() => {});
  }, [load]);

  const filteredGuestHouses = useMemo(() => {
    return guestHouses.filter((gh) => {
      if (filterQuarter && gh.quarter !== filterQuarter) return false;
      if (filterCoastalOnly && !gh.is_coastal_leisure) return false;
      return true;
    });
  }, [guestHouses, filterQuarter, filterCoastalOnly]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSubmitStatus("submitting");
    try {
      const guestHouse = await createGuestHouse(
        {
          quarter: quarterId, is_coastal_leisure: isCoastalLeisure, finish_level: finishLevel,
          latitude: gpsCoords.latitude ?? undefined, longitude: gpsCoords.longitude ?? undefined,
        },
        token
      );
      for (const m of media) await addGuestHousePhoto(guestHouse.id, m.url, m.media_type, token);
      setShowForm(false);
      setIsCoastalLeisure(false);
      setGpsCoords(EMPTY_GPS);
      setMedia([]);
      load();
    } catch {
      setSubmitStatus("error");
      return;
    }
    setSubmitStatus("idle");
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-10">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 shadow-md shadow-amber-500/20"
          >
            <span>{showForm ? t("cancel") : `+ ${t("listYourGuestHouse")}`}</span>
          </Button>
        }
      />

      {/* ================= GUEST HOUSE ASSURANCES ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
            <IconHome size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Fully Furnished Stays</h4>
            <p className="text-xs text-slate-500 mt-0.5">Equipped kitchens, linens, and housekeeping available</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <IconShieldCheck size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">24/7 Power &amp; Water</h4>
            <p className="text-xs text-slate-500 mt-0.5">Generator backups and borehole water verified</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <IconLock size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Secure Escrow Protection</h4>
            <p className="text-xs text-slate-500 mt-0.5">Payment released after smooth check-in confirmation</p>
          </div>
        </div>
      </div>

      {/* ================= DISCOVERY & FILTER BAR ================= */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-sm mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Destination Quarter
            </label>
            <div className="relative flex items-center">
              <IconMapPin size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <select
                value={filterQuarter}
                onChange={(e) => setFilterQuarter(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">All Neighborhoods</option>
                <QuarterOptions quarters={quarters} />
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Coastal / Leisure Only
            </label>
            <button
              type="button"
              onClick={() => setFilterCoastalOnly(!filterCoastalOnly)}
              className={`w-full py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                filterCoastalOnly
                  ? "bg-teal-50 border-teal-500 text-teal-800"
                  : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>🌊 Coastal &amp; Beachfront Only</span>
              {filterCoastalOnly && <span className="font-bold">✓</span>}
            </button>
          </div>

          <div>
            <button
              onClick={() => {
                setFilterQuarter("");
                setFilterCoastalOnly(false);
              }}
              className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-600 transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* ================= ELEVATED GUEST HOUSE CREATION FORM ================= */}
      {showForm && (
        <div className="border border-slate-200/80 rounded-2xl p-6 sm:p-8 bg-white mb-10 shadow-xl shadow-slate-200/50 animate-rise-in">
          <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-sm">
              🏡
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">List Your Guest House or Short Stay</h3>
              <p className="text-xs text-slate-500">
                Welcome business travelers, holidaymakers, and visiting families with automated Mobile Money deposits.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Location Quarter <span className="text-red-500">*</span>
              </label>
              <select
                value={quarterId}
                onChange={(e) => setQuarterId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                required
              >
                <option value="" disabled>Choose a neighborhood…</option>
                <QuarterOptions quarters={quarters} />
              </select>
              <MissingAreaRequest quarters={quarters} className="mt-1.5" />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Interior Finish Standard
              </label>
              <select
                value={finishLevel}
                onChange={(e) => setFinishLevel(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="STANDARD">{t("finishStandard")}</option>
                <option value="MODERN">{t("finishModern")}</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isCoastalLeisure}
                  onChange={(e) => setIsCoastalLeisure(e.target.checked)}
                  className="rounded text-teal-600 focus:ring-teal-500 w-4 h-4"
                />
                <span className="text-sm font-semibold text-slate-800">
                  {t("coastalLeisure")} (Beachfront or vacation lodge in Kribi, Limbe, etc.)
                </span>
              </label>
            </div>

            <LocationCapture className="md:col-span-2" value={gpsCoords} onChange={setGpsCoords} />

            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Photos (Rooms, Living Room, Kitchen, Compound)
              </label>
              <MediaUploader
                folder="guest-houses"
                onUploaded={(m) => setMedia((prev) => [...prev, m])}
                label={t("addPhotoOrVideo")}
              />
              {media.length > 0 && (
                <p className="text-xs text-emerald-600 font-medium mt-1.5">
                  ✓ {t("mediaAttached", { count: media.length })}
                </p>
              )}
              <MediaThumbs items={media} onRemove={(i) => setMedia((prev) => prev.filter((_, idx) => idx !== i))} />
            </div>

            {submitStatus === "error" && (
              <p className="text-red-600 text-xs md:col-span-2 font-medium">{t("submitFailed")}</p>
            )}

            <div className="md:col-span-2 flex gap-3 pt-2">
              <Button disabled={submitStatus === "submitting"} className="flex-1" size="lg">
                {submitStatus === "submitting" ? t("submitting") : t("submitGuestHouse")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)} size="lg">
                {t("cancel")}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ================= LISTINGS DISPLAY ================= */}
      {status === "loading" ? (
        <div className="py-20 text-center text-slate-400">Loading guest houses...</div>
      ) : guestHouses.length > 0 ? (
        /* Real live guest houses from the backend */
        <div>
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-slate-900 text-lg">
              {filteredGuestHouses.length} {filteredGuestHouses.length === 1 ? "Guest House Available" : "Guest Houses Available"}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredGuestHouses.map((gh) => {
              const photo = gh.photos?.find((p) => p.media_type === "PHOTO");
              return (
                <AssetCard
                  key={gh.id}
                  href={`/guest-houses/${gh.id}`}
                  photoUrl={photo?.url}
                  listerRole={gh.lister_role}
                  listerRating={gh.lister_average_rating}
                  listerRatingCount={gh.lister_rating_count}
                  statusBadge={
                    gh.is_coastal_leisure ? (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-teal-600 text-white">{t("coastalLeisure")}</span>
                    ) : undefined
                  }
                  share={{ title: "guest house", location: gh.quarter_name, path: `/guest-houses/${gh.id}` }}
                  typeLabel="Guest House"
                  location={gh.quarter_name}
                  mapsHref={
                    gh.latitude && gh.longitude
                      ? `https://www.google.com/maps/dir/?api=1&destination=${gh.latitude},${gh.longitude}`
                      : undefined
                  }
                  details={
                    gh.amenities.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {gh.amenities.slice(0, 4).map((a) => (
                          <span key={a} className="text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                            {t(`amenity_${a}`)}
                          </span>
                        ))}
                      </div>
                    ) : undefined
                  }
                >
                  {gh.owner && (
                    <>
                      <Link
                        href={`/guest-houses/${gh.id}`}
                        className="w-full text-center text-xs font-black text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg transition-colors"
                      >
                        Book Now →
                      </Link>
                      <DirectChatButton
                        recipientId={gh.owner}
                        recipientName={gh.owner_name || "Guest House Host"}
                        label="Message Host"
                        className="w-full inline-flex items-center justify-center gap-1.5 bg-slate-900 text-amber-300 font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-slate-800 transition-colors"
                      />
                    </>
                  )}
                </AssetCard>
              );
            })}
          </div>
        </div>
      ) : (
        /* Professional Showcase Cards when Database is empty */
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-teal-50 border border-teal-200 text-[11px] font-bold uppercase tracking-wider text-teal-800 mb-1">
                <IconSparkles size={12} />
                <span>Verified Short Stays Preview</span>
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-slate-900">
                Furnished Lodges &amp; Coastal Getaways in Cameroon
              </h3>
            </div>
            <p className="text-xs text-slate-500 max-w-xs">
              Every lodge features guaranteed generator power and independent clean water supply.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
            {SHOWCASE_GUEST_HOUSES.map((item) => (
              <div
                key={item.id}
                className="group bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="relative h-44 overflow-hidden bg-slate-100">
                    <img
                      src={item.photo_url}
                      alt={item.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-600 text-white text-[10px] font-bold uppercase">
                      <span>{item.is_coastal ? "Coastal Villa" : "City Executive"}</span>
                    </div>

                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/80 to-transparent p-3">
                      <p className="text-white text-base font-bold">
                        {item.rate_xaf} <span className="text-[11px] font-normal text-slate-200">XAF / {item.unit_label}</span>
                      </p>
                    </div>
                  </div>

                  <div className="p-4">
                    <h4 className="font-bold text-slate-900 text-sm mb-1 line-clamp-1 group-hover:text-amber-600 transition-colors">
                      {item.name}
                    </h4>

                    <p className="text-xs text-slate-500 flex items-center gap-1 mb-2.5">
                      <IconMapPin size={12} className="text-amber-500 shrink-0" />
                      <span className="truncate">{item.quarter_name}</span>
                    </p>

                    <div className="flex flex-wrap gap-1 mb-2">
                      {item.amenities.slice(0, 2).map((am) => (
                        <span key={am} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                          {am}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-4 pt-0">
                  <button
                    onClick={() => setInterestItem(item.name)}
                    className="w-full py-2 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition-colors text-center"
                  >
                    Book Now
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-r from-teal-950 via-slate-900 to-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-base">Own a Furnished Apartment or Coastal Villa?</h4>
              <p className="text-xs text-slate-300 mt-1">
                Reach tourists, business travelers, and diaspora returnees with guaranteed reservation escrow.
              </p>
            </div>
            <Button onClick={() => setShowForm(true)} className="whitespace-nowrap shrink-0">
              {t("listYourGuestHouse")}
            </Button>
          </div>
        </div>
      )}

      {interestItem && (
        <InterestCaptureModal itemName={interestItem} variant="booking" onClose={() => setInterestItem(null)} />
      )}
    </main>
  );
}

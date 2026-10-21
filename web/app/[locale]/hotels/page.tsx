"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { searchHotels, createHotel, addHotelPhoto, createReservation, listQuarters, type Hotel, type RoomTypeSummary, type Quarter, type MediaUploadResult } from "@/lib/api";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import PageHeader from "@/components/ui/PageHeader";
import AssetCard from "@/components/AssetCard";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import MediaThumbs from "@/components/MediaThumbs";
import LocationCapture from "@/components/LocationCapture";
import DirectChatButton from "@/components/DirectChatButton";
import { Link } from "@/i18n/navigation";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";
import InterestCaptureModal from "@/components/InterestCaptureModal";
import BookingCheckoutModal from "@/components/BookingCheckoutModal";
import {
  IconHotel,
  IconMapPin,
  IconStar,
  IconShieldCheck,
  IconClock,
  IconLock,
  IconSearch,
  IconSparkles,
  IconCheckCircle,
} from "@/components/Icons";

const ROOM_CATEGORIES = ["STANDARD", "DELUXE", "SUITE", "EXECUTIVE", "FAMILY", "ACCESSIBLE"] as const;

// Curated Cameroon hotel showcases when database has no live listings yet
const SHOWCASE_HOTELS = [
  {
    id: "showcase-h1",
    name: "Kribi Oceanfront Resort & Spa",
    quarter_name: "Kribi Beachfront, South",
    star_rating: 4,
    verified: true,
    rooms_count: 3,
    cheapest_rate: "45,000",
    photo_url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80",
    amenities: ["Ocean View", "Private Beach", "Pool & Bar", "Fresh Seafood"],
  },
  {
    id: "showcase-h2",
    name: "Bastos Diplomatic Suites & Hotel",
    quarter_name: "Bastos, Yaoundé",
    star_rating: 5,
    verified: true,
    rooms_count: 5,
    cheapest_rate: "65,000",
    photo_url: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80",
    amenities: ["Free High-Speed WiFi", "Airport Shuttle", "Fitness Center", "Gourmet Dining"],
  },
  {
    id: "showcase-h3",
    name: "Douala Marina Executive Hotel",
    quarter_name: "Bonapriso, Douala",
    star_rating: 4,
    verified: true,
    rooms_count: 4,
    cheapest_rate: "55,000",
    photo_url: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=800&q=80",
    amenities: ["AC in all rooms", "Conference Hall", "Backup Power", "Executive Lounge"],
  },
  {
    id: "showcase-h4",
    name: "Buea Mountain View Lodge",
    quarter_name: "Molyko / Clerks Quarter, Buea",
    star_rating: 3,
    verified: true,
    rooms_count: 2,
    cheapest_rate: "35,000",
    photo_url: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=800&q=80",
    amenities: ["Mountain View", "Breakfast Included", "Secure Parking", "24/7 Hot Water"],
  },
];

export default function HotelsPage() {
  const t = useTranslations("HotelsPage");
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

  // Filter states
  const [searchQuarter, setSearchQuarter] = useState("");
  const [filterStar, setFilterStar] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  // Form states
  const [quarterId, setQuarterId] = useState("");
  const [starRating, setStarRating] = useState("");
  const [hotelName, setHotelName] = useState("");
  const [roomCategory, setRoomCategory] = useState<string>("STANDARD");
  const [roomCapacity, setRoomCapacity] = useState("2");
  const [roomRate, setRoomRate] = useState("");
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  // Booking modal state
  const [bookingHotel, setBookingHotel] = useState<Hotel | null>(null);
  const [bookingRoomType, setBookingRoomType] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [bookingStatus, setBookingStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [bookingError, setBookingError] = useState("");

  // Customer-facing direct booking modal state (both for live and showcase listings)
  const [activeCheckout, setActiveCheckout] = useState<{
    title: string;
    quarter: string;
    price: number | string;
    targetId: string;
    hotelObj?: Hotel | null;
  } | null>(null);
  const [interestItem, setInterestItem] = useState<string | null>(null);

  function openBooking(hotel: Hotel) {
    const cheapest = hotel.room_types[0];
    setActiveCheckout({
      title: hotel.name || "Cameroon Verified Hotel Stay",
      quarter: hotel.quarter_name,
      price: cheapest ? Number(cheapest.base_rate_xaf) : 45000,
      targetId: hotel.id,
      hotelObj: hotel,
    });
  }

  const selectedRoomType: RoomTypeSummary | undefined = bookingHotel?.room_types.find((rt) => rt.id === bookingRoomType);
  const nightsCount =
    checkIn && checkOut ? Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000) : 0;
  const bookingTotal =
    selectedRoomType && nightsCount > 0 ? nightsCount * Number(selectedRoomType.base_rate_xaf) : 0;

  async function handleBookingSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    if (!checkIn || !checkOut || nightsCount <= 0) {
      setBookingStatus("error");
      setBookingError(t("invalidDateRange"));
      return;
    }
    setBookingStatus("submitting");
    try {
      await createReservation(
        {
          room_type: bookingRoomType,
          check_in: checkIn,
          check_out: checkOut,
          adults: Number(adults),
          children: Number(children),
        },
        token
      );
      setBookingStatus("success");
    } catch (err) {
      setBookingStatus("error");
      setBookingError(err instanceof Error ? err.message : t("bookingFailed"));
    }
  }

  const load = useCallback(() => {
    searchHotels()
      .then((data) => setHotels(data.results))
      .catch(() => setHotels([]))
      .finally(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    load();
    listQuarters()
      .then((data) => {
        setQuarters(data);
      })
      .catch(() => {});
    // Shared/chatbot links can preselect the area and budget (?quarter=<id>&max_price=<xaf>).
    // Read after mount so the server-rendered page and the first client render match.
    Promise.resolve().then(() => {
      const params = new URLSearchParams(window.location.search);
      const presetQuarter = params.get("quarter");
      const presetBudget = params.get("max_price");
      if (presetQuarter) setSearchQuarter(presetQuarter);
      if (presetBudget) setMaxPrice(presetBudget);
    });
  }, [load]);

  // Filtered live hotel listings
  const filteredHotels = useMemo(() => {
    return hotels.filter((h) => {
      if (searchQuarter && h.quarter !== searchQuarter) return false;
      if (filterStar && h.star_rating !== Number(filterStar)) return false;
      if (maxPrice) {
        const cheapest = h.room_types.length
          ? Math.min(...h.room_types.map((rt) => Number(rt.base_rate_xaf) || 0))
          : 0;
        if (cheapest > Number(maxPrice)) return false;
      }
      return true;
    });
  }, [hotels, searchQuarter, filterStar, maxPrice]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSubmitStatus("submitting");
    try {
      const hotel = await createHotel(
        {
          quarter: quarterId,
          name: hotelName.trim() || undefined,
          star_rating: starRating ? Number(starRating) : undefined,
          latitude: gpsCoords.latitude ?? undefined,
          longitude: gpsCoords.longitude ?? undefined,
          room_types: [{ category: roomCategory, capacity: Number(roomCapacity), base_rate_xaf: roomRate }],
        },
        token
      );
      for (const m of media) await addHotelPhoto(hotel.id, m.url, m.media_type, token);
      setShowForm(false);
      setStarRating("");
      setHotelName("");
      setRoomRate("");
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
            <span>{showForm ? t("cancel") : `+ ${t("listYourHotel")}`}</span>
          </Button>
        }
      />

      {/* ================= TRUST & SAFETY STRIP ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <IconShieldCheck size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Verified Hotel Operators</h4>
            <p className="text-xs text-slate-500 mt-0.5">Physical properties checked before listing</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <IconClock size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">7-Minute Hold Guarantee</h4>
            <p className="text-xs text-slate-500 mt-0.5">Rooms reserved exclusively during checkout</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <IconLock size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Mobile Money Escrow</h4>
            <p className="text-xs text-slate-500 mt-0.5">Pay via MTN MoMo or Orange Money safely</p>
          </div>
        </div>
      </div>

      {/* ================= SEARCH & DISCOVERY BAR ================= */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-sm mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Destination / Quarter
            </label>
            <div className="relative flex items-center">
              <IconMapPin size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <select
                value={searchQuarter}
                onChange={(e) => setSearchQuarter(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">All Locations</option>
                <QuarterOptions quarters={quarters} />
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Rating Filter
            </label>
            <div className="relative flex items-center">
              <IconStar size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <select
                value={filterStar}
                onChange={(e) => setFilterStar(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">Any Star Rating</option>
                <option value="5">5 Stars (Luxury)</option>
                <option value="4">4 Stars (Premium)</option>
                <option value="3">3 Stars (Standard)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Budget per Night
            </label>
            <input
              type="number"
              placeholder="Max XAF per night"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            />
          </div>

          <div>
            <button
              onClick={() => {
                setSearchQuarter("");
                setFilterStar("");
                setMaxPrice("");
              }}
              className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-600 transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* ================= ELEVATED LISTING CREATION FORM ================= */}
      {showForm && (
        <div className="border border-slate-200/80 rounded-2xl p-6 sm:p-8 bg-white mb-10 shadow-xl shadow-slate-200/50 animate-rise-in">
          <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-sm">
              +
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">List Your Hotel on Oaziland</h3>
              <p className="text-xs text-slate-500">
                Join verified hotel operators reaching business and vacation travelers across Cameroon.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Neighborhood / Quarter <span className="text-red-500">*</span>
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

            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                {t("hotelNameLabel")}
              </label>
              <input
                maxLength={200}
                placeholder={t("hotelNamePlaceholder")}
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Official Star Rating (Optional)
              </label>
              <input
                type="number"
                min={1}
                max={5}
                placeholder={t("starRatingPlaceholder")}
                value={starRating}
                onChange={(e) => setStarRating(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <LocationCapture className="md:col-span-2" value={gpsCoords} onChange={setGpsCoords} />

            <div className="md:col-span-2 pt-2 border-t border-slate-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">
                {t("firstRoomTypeLabel")}
              </h4>
              <p className="text-xs text-slate-500 mb-3">Every hotel needs at least one bookable room rate.</p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Room Category
              </label>
              <select
                value={roomCategory}
                onChange={(e) => setRoomCategory(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                {ROOM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Guest Capacity
              </label>
              <input
                type="number"
                min={1}
                placeholder={t("capacityPlaceholder")}
                value={roomCapacity}
                onChange={(e) => setRoomCapacity(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Nightly Rate in XAF <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="number"
                placeholder={t("ratePerNightPlaceholder")}
                value={roomRate}
                onChange={(e) => setRoomRate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Property Photos &amp; Video
              </label>
              <MediaUploader
                folder="hotels"
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

            <div className="md:col-span-2 p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/60 text-xs text-amber-900 leading-relaxed">
              <span className="font-bold">Notice:</span> {t("verificationNotice")}
            </div>

            <div className="md:col-span-2 flex gap-3 pt-2">
              <Button disabled={submitStatus === "submitting"} className="flex-1" size="lg">
                {submitStatus === "submitting" ? t("submitting") : t("submitHotel")}
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
        <div className="py-20 text-center text-slate-400">Loading hotels...</div>
      ) : hotels.length > 0 ? (
        /* Real live hotels from the backend */
        <div>
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-slate-900 text-lg">
              {filteredHotels.length} {filteredHotels.length === 1 ? "Hotel Available" : "Hotels Available"}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredHotels.map((hotel) => {
              const cheapestRoom = hotel.room_types.length
                ? hotel.room_types.reduce((min, rt) =>
                    Number(rt.base_rate_xaf) < Number(min.base_rate_xaf) ? rt : min
                  )
                : null;
              const photo = hotel.photos?.find((p) => p.media_type === "PHOTO");

              return (
                <AssetCard
                  key={hotel.id}
                  href={`/hotels/${hotel.id}`}
                  photoUrl={photo?.url}
                  listerRole={hotel.lister_role}
                  listerRating={hotel.lister_average_rating}
                  listerRatingCount={hotel.lister_rating_count}
                  statusBadge={
                    hotel.verified ? (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500 text-white">Verified</span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-400 text-slate-950">
                        {t("pendingReviewBadge")}
                      </span>
                    )
                  }
                  share={{
                    title: "hotel",
                    location: hotel.quarter_name,
                    price: cheapestRoom ? Number(cheapestRoom.base_rate_xaf).toLocaleString() : "",
                    path: `/hotels/${hotel.id}`,
                  }}
                  price={cheapestRoom ? Number(cheapestRoom.base_rate_xaf).toLocaleString() : undefined}
                  priceUnit={t("perNight")}
                  typeLabel={hotel.name || "Hotel"}
                  location={hotel.quarter_name}
                  mapsHref={
                    hotel.latitude && hotel.longitude
                      ? `https://www.google.com/maps/dir/?api=1&destination=${hotel.latitude},${hotel.longitude}`
                      : undefined
                  }
                  details={
                    <>
                      {hotel.star_rating && (
                        <span className="flex items-center gap-0.5 text-amber-400">
                          {Array.from({ length: hotel.star_rating }).map((_, i) => (
                            <IconStar key={i} size={14} />
                          ))}
                        </span>
                      )}
                      <span>
                        {hotel.room_types.length === 1
                          ? t("roomsAvailable", { count: hotel.room_types.length })
                          : t("roomsAvailableOther", { count: hotel.room_types.length })}
                      </span>
                    </>
                  }
                >
                  {cheapestRoom && (
                    <button
                      onClick={() => openBooking(hotel)}
                      className="w-full text-xs font-black text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg transition-colors"
                    >
                      Reserve →
                    </button>
                  )}
                  {hotel.owner && (
                    <DirectChatButton
                      recipientId={hotel.owner}
                      recipientName={hotel.owner_name || "Hotel Manager"}
                      label="Message Hotel Manager"
                      className="w-full inline-flex items-center justify-center gap-1.5 bg-slate-900 text-amber-300 font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-slate-800 transition-colors"
                    />
                  )}
                </AssetCard>
              );
            })}
          </div>
        </div>
      ) : (
        /* Professional Showcase Cards when Database is empty — eliminates the bare empty void */
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-1">
                <IconSparkles size={12} />
                <span>Premier Destination Preview</span>
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-slate-900">
                Featured Verified Accommodations in Cameroon
              </h3>
            </div>
            <p className="text-xs text-slate-500 max-w-xs">
              Live bookings open as hotel partners complete their local verification audits.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
            {SHOWCASE_HOTELS.map((item) => (
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
                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500 text-white text-[10px] font-bold uppercase">
                      <IconShieldCheck size={11} />
                      <span>Verified</span>
                    </div>

                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/80 to-transparent p-3">
                      <p className="text-white text-base font-bold">
                        {item.cheapest_rate} <span className="text-[11px] font-normal text-slate-200">XAF / night</span>
                      </p>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="flex items-center gap-1 text-amber-400 text-xs mb-1.5">
                      {Array.from({ length: item.star_rating }).map((_, r) => (
                        <IconStar key={r} size={13} />
                      ))}
                    </div>

                    <h4 className="font-bold text-slate-900 text-sm mb-1 line-clamp-1 group-hover:text-amber-600 transition-colors">
                      {item.name}
                    </h4>

                    <p className="text-xs text-slate-500 flex items-center gap-1 mb-3">
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
                    onClick={() => {
                      const matchedHotel = hotels.find((h) => h.quarter_name.toLowerCase().includes(item.quarter_name.toLowerCase().split(",")[0]));
                      setActiveCheckout({
                        title: item.name,
                        quarter: item.quarter_name,
                        price: item.cheapest_rate.replace(/,/g, ""),
                        targetId: matchedHotel ? matchedHotel.id : item.id,
                        hotelObj: matchedHotel || null,
                      });
                    }}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black transition-colors text-center shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5"
                  >
                    <IconLock size={13} />
                    <span>Book with Escrow Protection</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 to-amber-950 text-white flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-base">Own a Hotel or Boutique Stay in Cameroon?</h4>
              <p className="text-xs text-slate-300 mt-1">
                Reach thousands of verified domestic and diaspora travelers with automated reservation deposits.
              </p>
            </div>
            <Button onClick={() => setShowForm(true)} className="whitespace-nowrap shrink-0">
              {t("listYourHotel")}
            </Button>
          </div>
        </div>
      )}

      {/* ================= BOOKING MODAL ================= */}
      {bookingHotel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            {bookingStatus === "success" ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                  <IconCheckCircle size={24} />
                </div>
                <h3 className="font-bold text-slate-900 text-lg mb-1.5">{t("bookingConfirmedTitle")}</h3>
                <p className="text-xs text-slate-500 mb-5">{t("bookingConfirmedBody")}</p>
                <div className="flex gap-2">
                  <Link
                    href="/bookings"
                    className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors text-center"
                  >
                    {t("viewMyBookings")}
                  </Link>
                  <button
                    onClick={() => setBookingHotel(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-colors"
                  >
                    {t("close")}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleBookingSubmit}>
                <div className="flex items-start justify-between mb-4">
                  <h3 className="font-bold text-slate-900 text-lg">{t("bookRoom")}</h3>
                  <button type="button" onClick={() => setBookingHotel(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
                    &times;
                  </button>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {t("selectRoomType")}
                    </label>
                    <select
                      value={bookingRoomType}
                      onChange={(e) => setBookingRoomType(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                    >
                      {bookingHotel.room_types.map((rt) => (
                        <option key={rt.id} value={rt.id}>
                          {rt.category} — {Number(rt.base_rate_xaf).toLocaleString()} XAF/night
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        {t("checkIn")}
                      </label>
                      <input
                        required
                        type="date"
                        min={new Date().toISOString().slice(0, 10)}
                        value={checkIn}
                        onChange={(e) => setCheckIn(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        {t("checkOut")}
                      </label>
                      <input
                        required
                        type="date"
                        min={checkIn || new Date().toISOString().slice(0, 10)}
                        value={checkOut}
                        onChange={(e) => setCheckOut(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        {t("adults")}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={adults}
                        onChange={(e) => setAdults(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        {t("children")}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={children}
                        onChange={(e) => setChildren(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                      />
                    </div>
                  </div>

                  {nightsCount > 0 && selectedRoomType && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/60 flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-900">
                        {nightsCount === 1 ? t("nights", { count: nightsCount }) : t("nightsOther", { count: nightsCount })}
                      </span>
                      <span className="text-sm font-bold text-slate-900">
                        {t("totalPrice")}: {bookingTotal.toLocaleString()} XAF
                      </span>
                    </div>
                  )}

                  {bookingStatus === "error" && <p className="text-red-600 text-xs font-medium">{bookingError}</p>}

                  <Button disabled={bookingStatus === "submitting"} className="w-full" size="lg">
                    {bookingStatus === "submitting" ? t("bookingSubmitting") : t("confirmBooking")}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {activeCheckout && (
        <BookingCheckoutModal
          isOpen={true}
          onClose={() => setActiveCheckout(null)}
          bookingType="HOTEL"
          title={activeCheckout.title}
          quarterName={activeCheckout.quarter}
          priceXaf={activeCheckout.price}
          pricePeriodLabel="per night"
          targetId={activeCheckout.targetId}
          targetContentType="hotels.Hotel"
          hotelObject={activeCheckout.hotelObj}
        />
      )}

      {interestItem && (
        <InterestCaptureModal itemName={interestItem} onClose={() => setInterestItem(null)} />
      )}
    </main>
  );
}

"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { searchVenues, createVenue, addVenuePhoto, createEventBooking, listQuarters, type Venue, type VenueSpaceSummary, type Quarter, type MediaUploadResult } from "@/lib/api";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import PageHeader from "@/components/ui/PageHeader";
import AssetCard from "@/components/AssetCard";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import LocationCapture, { EMPTY_GPS, type GpsValue } from "@/components/LocationCapture";
import MediaThumbs from "@/components/MediaThumbs";
import DirectChatButton from "@/components/DirectChatButton";
import InterestCaptureModal from "@/components/InterestCaptureModal";
import {
  IconParty,
  IconMapPin,
  IconShieldCheck,
  IconLock,
  IconClock,
  IconSparkles,
  IconUsers,
  IconCheckCircle,
} from "@/components/Icons";

const SHOWCASE_VENUES = [
  {
    id: "showcase-v1",
    name: "Palais des Banquets & Conférences",
    quarter_name: "Bastos, Yaoundé",
    theatre_capacity: 600,
    banquet_capacity: 350,
    price_per_hour: "95,000",
    verified: true,
    photo_url: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=800&q=80",
    amenities: ["Stage & Pro Audio", "Industrial AC", "VIP Parking (80 cars)", "Commercial Catering Kitchen"],
  },
  {
    id: "showcase-v2",
    name: "Akwa Grand Ballroom & Terrace",
    quarter_name: "Akwa, Douala",
    theatre_capacity: 450,
    banquet_capacity: 280,
    price_per_hour: "85,000",
    verified: true,
    photo_url: "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=800&q=80",
    amenities: ["Crystal Chandeliers", "Backup Generator", "Bridal Dressing Suite", "Security Team"],
  },
  {
    id: "showcase-v3",
    name: "Kribi Oceanfront Wedding Gardens",
    quarter_name: "Kribi Beachfront, South",
    theatre_capacity: 300,
    banquet_capacity: 220,
    price_per_hour: "75,000",
    verified: true,
    photo_url: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?auto=format&fit=crop&w=800&q=80",
    amenities: ["Beachside Marquee", "Sunset Photography Deck", "Full Bar Setup", "Lawn Lighting"],
  },
  {
    id: "showcase-v4",
    name: "Buea Summit Tech & Business Pavilion",
    quarter_name: "Molyko, Buea",
    theatre_capacity: 250,
    banquet_capacity: 150,
    price_per_hour: "50,000",
    verified: true,
    photo_url: "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=800&q=80",
    amenities: ["Dual Laser Projectors", "Gigabit Internet", "Podium & Microphones", "Coffee Break Area"],
  },
];

export default function EventsPage() {
  const t = useTranslations("VenuesPage");
  const [venues, setVenues] = useState<Venue[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

  // Filter states
  const [filterQuarter, setFilterQuarter] = useState("");
  const [filterCapacity, setFilterCapacity] = useState("");

  // Form states
  const [quarterId, setQuarterId] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [capacityTheatre, setCapacityTheatre] = useState("");
  const [capacityBanquet, setCapacityBanquet] = useState("");
  const [pricePerHour, setPricePerHour] = useState("");
  const [gpsCoords, setGpsCoords] = useState<GpsValue>(EMPTY_GPS);
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  // Booking modal state
  const [bookingVenue, setBookingVenue] = useState<Venue | null>(null);
  const [bookingSpace, setBookingSpace] = useState("");
  const [eventType, setEventType] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [bookingStatus, setBookingStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [bookingError, setBookingError] = useState("");

  // Customer-facing lead capture on showcase (preview) cards - these
  // aren't real bookable venues yet, so the primary card action must
  // speak to an event organiser, not a venue owner.
  const [interestItem, setInterestItem] = useState<string | null>(null);

  function openBooking(venue: Venue) {
    setBookingVenue(venue);
    setBookingSpace(venue.spaces[0]?.id ?? "");
    setEventType("");
    setEventDate("");
    setStartTime("");
    setEndTime("");
    setGuestCount("");
    setBookingStatus("idle");
    setBookingError("");
  }

  const selectedSpace: VenueSpaceSummary | undefined = bookingVenue?.spaces.find((s) => s.id === bookingSpace);
  const estimatedHours =
    startTime && endTime ? (new Date(`2000-01-01T${endTime}`).getTime() - new Date(`2000-01-01T${startTime}`).getTime()) / 3600000 : 0;
  const bookingTotal = selectedSpace && estimatedHours > 0 ? estimatedHours * Number(selectedSpace.base_price_per_hour_xaf) : 0;

  async function handleBookingSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setBookingStatus("submitting");
    try {
      await createEventBooking(
        {
          venue_space: bookingSpace,
          event_type: eventType,
          event_date: eventDate,
          start_time: startTime,
          end_time: endTime,
          guest_count: Number(guestCount),
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
    searchVenues()
      .then((data) => setVenues(data.results))
      .catch(() => setVenues([]))
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

  const filteredVenues = useMemo(() => {
    return venues.filter((v) => {
      if (filterQuarter && v.quarter !== filterQuarter) return false;
      if (filterCapacity) {
        const minRequired = Number(filterCapacity);
        const maxCapacity = Math.max(
          ...v.spaces.map((s) => Math.max(s.capacity_banquet || 0, s.capacity_theatre || 0))
        );
        if (maxCapacity < minRequired) return false;
      }
      return true;
    });
  }, [venues, filterQuarter, filterCapacity]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSubmitStatus("submitting");
    try {
      const venue = await createVenue(
        {
          quarter: quarterId,
          latitude: gpsCoords.latitude ?? undefined,
          longitude: gpsCoords.longitude ?? undefined,
          spaces: [
            {
              space_name: spaceName,
              capacity_theatre: capacityTheatre ? Number(capacityTheatre) : undefined,
              capacity_banquet: capacityBanquet ? Number(capacityBanquet) : undefined,
              base_price_per_hour_xaf: pricePerHour,
            },
          ],
        },
        token
      );
      for (const m of media) await addVenuePhoto(venue.id, m.url, m.media_type, token);
      setShowForm(false);
      setSpaceName("");
      setCapacityTheatre("");
      setCapacityBanquet("");
      setPricePerHour("");
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
            <span>{showForm ? t("cancel") : `+ ${t("listYourVenue")}`}</span>
          </Button>
        }
      />

      {/* ================= VENUE SAFETY STRIP ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0">
            <IconShieldCheck size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Verified Capacity</h4>
            <p className="text-xs text-slate-500 mt-0.5">Theatre &amp; banquet guest numbers physically inspected</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <IconClock size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Locked Event Date</h4>
            <p className="text-xs text-slate-500 mt-0.5">Your chosen event date is secured instantly via 7-min hold</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <IconLock size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">MoMo Security Escrow</h4>
            <p className="text-xs text-slate-500 mt-0.5">Deposit protected until venue access is confirmed</p>
          </div>
        </div>
      </div>

      {/* ================= DISCOVERY & FILTER BAR ================= */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-sm mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Event City / Quarter
            </label>
            <div className="relative flex items-center">
              <IconMapPin size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <select
                value={filterQuarter}
                onChange={(e) => setFilterQuarter(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">All Locations</option>
                <QuarterOptions quarters={quarters} />
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Minimum Guest Capacity
            </label>
            <div className="relative flex items-center">
              <IconUsers size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <select
                value={filterCapacity}
                onChange={(e) => setFilterCapacity(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">Any Capacity</option>
                <option value="100">100+ Guests</option>
                <option value="250">250+ Guests</option>
                <option value="500">500+ Guests</option>
              </select>
            </div>
          </div>

          <div>
            <button
              onClick={() => {
                setFilterQuarter("");
                setFilterCapacity("");
              }}
              className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-600 transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* ================= ELEVATED VENUE CREATION FORM ================= */}
      {showForm && (
        <div className="border border-slate-200/80 rounded-2xl p-6 sm:p-8 bg-white mb-10 shadow-xl shadow-slate-200/50 animate-rise-in">
          <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center font-bold text-sm">
              🎉
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">List Your Event Venue on Oaziland</h3>
              <p className="text-xs text-slate-500">
                Host weddings, conferences, banquets, and celebrations with secured booking deposits.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
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

            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Primary Space Name <span className="text-red-500">*</span>
              </label>
              <input
                required
                placeholder={t("spaceNamePlaceholder")}
                value={spaceName}
                onChange={(e) => setSpaceName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Theatre Seating Capacity
              </label>
              <input
                type="number"
                placeholder={t("theatreCapacity", { count: 300 })}
                value={capacityTheatre}
                onChange={(e) => setCapacityTheatre(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Banquet / Round Table Capacity
              </label>
              <input
                type="number"
                placeholder={t("banquetCapacity", { count: 200 })}
                value={capacityBanquet}
                onChange={(e) => setCapacityBanquet(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Base Price per Hour (XAF) <span className="text-red-500">*</span>
              </label>
              <input
                required
                type="number"
                placeholder={t("pricePerHourPlaceholder")}
                value={pricePerHour}
                onChange={(e) => setPricePerHour(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <LocationCapture className="md:col-span-2" value={gpsCoords} onChange={setGpsCoords} />

            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Venue Photos (Main Hall, Stage, Parking, Exterior)
              </label>
              <MediaUploader
                folder="venues"
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

            <div className="md:col-span-2 p-3.5 rounded-xl bg-pink-50/70 border border-pink-200/60 text-xs text-pink-900 leading-relaxed">
              <span className="font-bold">Notice:</span> {t("verificationNotice")}
            </div>

            <div className="md:col-span-2 flex gap-3 pt-2">
              <Button disabled={submitStatus === "submitting"} className="flex-1" size="lg">
                {submitStatus === "submitting" ? t("submitting") : t("submitVenue")}
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
        <div className="py-20 text-center text-slate-400">Loading event venues...</div>
      ) : venues.length > 0 ? (
        /* Real live venues from the backend */
        <div>
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-slate-900 text-lg">
              {filteredVenues.length} {filteredVenues.length === 1 ? "Venue Available" : "Venues Available"}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredVenues.map((venue) => {
              const cheapestSpace = venue.spaces.length
                ? venue.spaces.reduce((min, s) =>
                    Number(s.base_price_per_hour_xaf) < Number(min.base_price_per_hour_xaf) ? s : min
                  )
                : null;
              const photo = venue.photos?.find((p) => p.media_type === "PHOTO");
              return (
                <AssetCard
                  key={venue.id}
                  href={`/events/${venue.id}`}
                  photoUrl={photo?.url}
                  listerRole={venue.lister_role}
                  listerRating={venue.lister_average_rating}
                  listerRatingCount={venue.lister_rating_count}
                  statusBadge={
                    venue.verified ? (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500 text-white">Verified Venue</span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-400 text-slate-950">
                        {t("pendingReviewBadge")}
                      </span>
                    )
                  }
                  share={{
                    title: "event venue",
                    location: venue.quarter_name,
                    price: cheapestSpace ? Number(cheapestSpace.base_price_per_hour_xaf).toLocaleString() : "",
                    path: `/events/${venue.id}`,
                  }}
                  price={cheapestSpace ? Number(cheapestSpace.base_price_per_hour_xaf).toLocaleString() : undefined}
                  priceUnit={t("perHour")}
                  typeLabel="Event Venue"
                  location={venue.quarter_name}
                  details={
                    <>
                      {venue.spaces[0]?.capacity_theatre && <span>🎭 {venue.spaces[0].capacity_theatre} Theatre</span>}
                      {venue.spaces[0]?.capacity_banquet && <span>🍽 {venue.spaces[0].capacity_banquet} Banquet</span>}
                      <span>
                        {venue.spaces.length === 1
                          ? t("spacesAvailable", { count: venue.spaces.length })
                          : t("spacesAvailableOther", { count: venue.spaces.length })}
                      </span>
                    </>
                  }
                >
                  {cheapestSpace && (
                    <button
                      onClick={() => openBooking(venue)}
                      className="w-full text-xs font-black text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg transition-colors"
                    >
                      Reserve Hall →
                    </button>
                  )}
                  {venue.owner && (
                    <DirectChatButton
                      recipientId={venue.owner}
                      recipientName={venue.owner_name || "Venue Host"}
                      label="Message Venue Host"
                      className="w-full inline-flex items-center justify-center gap-1.5 bg-slate-900 text-amber-300 font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-slate-800 transition-colors"
                    />
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
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-pink-50 border border-pink-200 text-[11px] font-bold uppercase tracking-wider text-pink-800 mb-1">
                <IconSparkles size={12} />
                <span>Featured Event Spaces Preview</span>
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-slate-900">
                Top Wedding Halls &amp; Conference Pavilions in Cameroon
              </h3>
            </div>
            <p className="text-xs text-slate-500 max-w-xs">
              Direct host booking with audio-visual equipment and guaranteed power backups.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
            {SHOWCASE_VENUES.map((item) => (
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
                      <span>Verified Hall</span>
                    </div>

                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/80 to-transparent p-3">
                      <p className="text-white text-base font-bold">
                        {item.price_per_hour} <span className="text-[11px] font-normal text-slate-200">XAF / hour</span>
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

                    <div className="flex items-center gap-3 text-xs text-slate-700 font-medium mb-3">
                      <span>🎭 {item.theatre_capacity} Th.</span>
                      <span>🍽 {item.banquet_capacity} Banq.</span>
                    </div>

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
                    Request to Book This Hall
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-r from-pink-950 via-slate-900 to-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-base">Have a Reception Hall, Terrace, or Conference Center?</h4>
              <p className="text-xs text-slate-300 mt-1">
                Reach wedding planners, corporate organizers, and event hosts across Douala, Yaoundé, and beyond.
              </p>
            </div>
            <Button onClick={() => setShowForm(true)} className="whitespace-nowrap shrink-0">
              {t("listYourVenue")}
            </Button>
          </div>
        </div>
      )}

      {/* ================= BOOKING MODAL ================= */}
      {bookingVenue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            {bookingStatus === "success" ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                  <IconCheckCircle size={24} />
                </div>
                <h3 className="font-bold text-slate-900 text-lg mb-1.5">{t("bookingConfirmedTitle")}</h3>
                <p className="text-xs text-slate-500 mb-5">{t("bookingConfirmedBody")}</p>
                <div className="flex gap-2">
                  <a
                    href="/bookings"
                    className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors"
                  >
                    {t("viewMyBookings")}
                  </a>
                  <button
                    onClick={() => setBookingVenue(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-colors"
                  >
                    {t("close")}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleBookingSubmit}>
                <div className="flex items-start justify-between mb-4">
                  <h3 className="font-bold text-slate-900 text-lg">{t("bookSpace")}</h3>
                  <button type="button" onClick={() => setBookingVenue(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
                    &times;
                  </button>
                </div>

                <div className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {t("selectSpace")}
                    </label>
                    <select
                      value={bookingSpace}
                      onChange={(e) => setBookingSpace(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                    >
                      {bookingVenue.spaces.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.space_name} — {Number(s.base_price_per_hour_xaf).toLocaleString()} XAF/hr
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {t("eventType")}
                    </label>
                    <input
                      required
                      placeholder="Wedding, Conference, Birthday..."
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {t("eventDate")}
                    </label>
                    <input
                      required
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        {t("startTime")}
                      </label>
                      <input
                        required
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        {t("endTime")}
                      </label>
                      <input
                        required
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {t("guestCount")}
                    </label>
                    <input
                      required
                      type="number"
                      min={1}
                      value={guestCount}
                      onChange={(e) => setGuestCount(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800"
                    />
                  </div>

                  {bookingTotal > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/60 flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-900">{t("totalLabel")}</span>
                      <span className="text-sm font-bold text-slate-900">{bookingTotal.toLocaleString()} XAF</span>
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

      {interestItem && (
        <InterestCaptureModal itemName={interestItem} onClose={() => setInterestItem(null)} />
      )}
    </main>
  );
}

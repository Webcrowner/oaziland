"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { searchStudentHostels, createStudentHostel, addStudentHostelPhoto, getMyProfile, listQuarters, type StudentHostel, type Quarter, type MediaUploadResult } from "@/lib/api";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import AssetCard from "@/components/AssetCard";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import MediaThumbs from "@/components/MediaThumbs";
import LocationCapture from "@/components/LocationCapture";
import JoinHostelWaitlistButton from "@/components/JoinHostelWaitlistButton";
import DirectChatButton from "@/components/DirectChatButton";
import {
  IconGraduationCap,
  IconMapPin,
  IconShieldCheck,
  IconLock,
  IconBuilding,
} from "@/components/Icons";

const PROPERTY_TYPES = ["BLOCK", "SELF_CONTAIN_COMPOUND", "STUDIO_COMPLEX", "APARTMENT_BUILDING", "MIXED"] as const;


export default function StudentHostelsPage() {
  const t = useTranslations("StudentHostelsPage");
  const tRooms = useTranslations("HostelRoomTypes");
  const locale = useLocale();
  const router = useRouter();
  const [hostelName, setHostelName] = useState("");
  // Agents may list for a landlord (their phone or username); the landlord then owns the hostel and is paid.
  const [isAgent, setIsAgent] = useState(false);
  const [landlord, setLandlord] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [hostels, setHostels] = useState<StudentHostel[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);
  useEffect(() => {
    if (!showForm) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyProfile(token).then((p) => setIsAgent(Boolean(p.is_agent))).catch(() => setIsAgent(false));
  }, [showForm]);

  // Filter states
  const [filterQuarter, setFilterQuarter] = useState("");
  const [filterType, setFilterType] = useState("");

  // Form states
  const [quarterId, setQuarterId] = useState("");
  const [propertyType, setPropertyType] = useState<string>("BLOCK");
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");


  const load = useCallback(() => {
    searchStudentHostels()
      .then((data) => setHostels(data.results))
      .catch(() => setHostels([]))
      .finally(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    load();
    // Shared/chatbot links can preselect the area (?quarter=<id>).
    const presetQuarter = new URLSearchParams(window.location.search).get("quarter");
    if (presetQuarter) {
      void Promise.resolve().then(() => setFilterQuarter(presetQuarter));
    }
    listQuarters()
      .then((data) => {
        setQuarters(data);
      })
      .catch(() => {});
  }, [load]);

  const filteredHostels = useMemo(() => {
    return hostels.filter((h) => {
      if (filterQuarter && h.quarter !== filterQuarter) return false;
      if (filterType && h.property_type !== filterType) return false;
      return true;
    });
  }, [hostels, filterQuarter, filterType]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login?next=%2Fstudent-hostels");
      return;
    }
    setSubmitStatus("submitting");
    setSubmitError("");
    try {
      const hostel = await createStudentHostel(
        {
          quarter: quarterId,
          name: hostelName.trim(),
          ...(isAgent && landlord.trim() ? { landlord: landlord.trim() } : {}),
          property_type: propertyType,
          latitude: gpsCoords.latitude ?? undefined,
          longitude: gpsCoords.longitude ?? undefined,
        },
        token
      );
      for (const m of media) await addStudentHostelPhoto(hostel.id, m.url, m.media_type, token);
      setShowForm(false);
      setMedia([]);
      setHostelName("");
      setLandlord("");
      // Next step: describe and price the room types students will book.
      router.push(`/hostel-rooms?hostel=${hostel.id}`);
      return;
    } catch (err) {
      setSubmitError(err instanceof Error && !err.message.startsWith("{") ? err.message : "");
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
            <span>{showForm ? t("cancel") : `+ ${t("listYourHostel")}`}</span>
          </Button>
        }
      />

      {/* ================= STUDENT PROTECTION GUARANTEES ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <IconGraduationCap size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Campus Proximity Checked</h4>
            <p className="text-xs text-slate-500 mt-0.5">Verified walking distance to major Cameroonian universities</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <IconShieldCheck size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Zero Rogue Agent Fees</h4>
            <p className="text-xs text-slate-500 mt-0.5">Deal directly with verified wardens and property managers</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <IconLock size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Installment-Friendly</h4>
            <p className="text-xs text-slate-500 mt-0.5">Semester &amp; trimester payment options supported via MoMo</p>
          </div>
        </div>
      </div>

      {/* ================= CAMPUS & NEIGHBORHOOD DISCOVERY BAR ================= */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-sm mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              University Campus / Neighborhood
            </label>
            <div className="relative flex items-center">
              <IconMapPin size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <select
                value={filterQuarter}
                onChange={(e) => setFilterQuarter(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">All Campuses &amp; Quarters</option>
                <QuarterOptions quarters={quarters} />
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Building Architecture Type
            </label>
            <div className="relative flex items-center">
              <IconBuilding size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">Any Layout</option>
                {PROPERTY_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <button
              onClick={() => {
                setFilterQuarter("");
                setFilterType("");
              }}
              className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-600 transition-colors"
            >
              Reset Campus Filters
            </button>
          </div>
        </div>
      </div>

      {/* ================= ELEVATED LISTING CREATION FORM ================= */}
      {showForm && (
        <div className="border border-slate-200/80 rounded-2xl p-6 sm:p-8 bg-white mb-10 shadow-xl shadow-slate-200/50 animate-rise-in">
          <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">
              🎓
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">List Your Student Accommodation</h3>
              <p className="text-xs text-slate-500">
                Connect with verified university students looking for reliable rooms near Cameroonian campuses.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label htmlFor="hostel-name" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                {tRooms("hostelNameLabel")}
              </label>
              <input
                id="hostel-name"
                value={hostelName}
                onChange={(e) => setHostelName(e.target.value)}
                maxLength={120}
                placeholder={tRooms("hostelNamePlaceholder")}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
              <p className="mt-1 text-[11px] text-slate-500">{tRooms("roomTypesNextStep")}</p>
            </div>
            {isAgent && (
              <div className="md:col-span-2">
                <label htmlFor="hostel-landlord" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  {tRooms("landlordLabel")}
                </label>
                <input
                  id="hostel-landlord"
                  value={landlord}
                  onChange={(e) => setLandlord(e.target.value)}
                  maxLength={150}
                  placeholder={tRooms("landlordPlaceholder")}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
                <p className="mt-1 text-[11px] text-slate-500">{tRooms("landlordHint")}</p>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Campus Quarter <span className="text-red-500">*</span>
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
                Hostel Complex Type
              </label>
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                {PROPERTY_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <LocationCapture className="md:col-span-2" value={gpsCoords} onChange={setGpsCoords} />

            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Photos &amp; Video (Rooms, Compound, Gate)
              </label>
              <MediaUploader
                folder="student-hostels"
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
              <p role="alert" className="text-red-600 text-xs md:col-span-2 font-medium">{submitError || t("submitFailed")}</p>
            )}

            <div className="md:col-span-2 p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200/60 text-xs text-indigo-900 leading-relaxed">
              <span className="font-bold">Student Trust Guarantee:</span> All listed student hostels agree to transparent utility pricing (prepaid light, borehole water) and zero hidden visitation fees.
            </div>

            <div className="md:col-span-2 flex gap-3 pt-2">
              <Button disabled={submitStatus === "submitting"} className="flex-1" size="lg">
                {submitStatus === "submitting" ? t("submitting") : t("submitHostel")}
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
        <div className="py-20 text-center text-slate-400">Loading student hostels...</div>
      ) : hostels.length > 0 ? (
        /* Real live hostels from the backend */
        <div>
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-slate-900 text-lg">
              {filteredHostels.length} {filteredHostels.length === 1 ? "Hostel Available" : "Hostels Available"}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredHostels.map((hostel) => {
              const totalBeds = hostel.units.reduce((sum, u) => sum + (u.bed_capacity || 0), 0);
              const photo = hostel.photos?.find((p) => p.media_type === "PHOTO") ?? null;
              const roomTypes = hostel.room_types ?? [];
              const freePlaces = roomTypes.reduce((sum, r) => sum + r.available_places, 0);
              const coverUrl = photo?.url ?? roomTypes.find((r) => r.photos.length > 0)?.photos[0].url;
              const fromPrice = hostel.from_price ? new Intl.NumberFormat(locale).format(Number(hostel.from_price.price_xaf)) : undefined;
              return (
                <AssetCard
                  key={hostel.id}
                  href={`/student-hostels/${hostel.id}`}
                  photoUrl={coverUrl}
                  listerRole={hostel.lister_role}
                  listerRating={hostel.lister_average_rating}
                  listerRatingCount={hostel.lister_rating_count}
                  statusBadge={
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500 text-white">Verified Campus</span>
                  }
                  share={{ title: hostel.name || t("hostelLabel"), location: hostel.quarter_name, path: `/student-hostels/${hostel.id}` }}
                  price={fromPrice ? tRooms("from", { price: fromPrice }) : undefined}
                  priceUnit={hostel.from_price ? tRooms(`unit_${hostel.from_price.price_period}`) : undefined}
                  typeLabel={hostel.name || hostel.property_type.replace(/_/g, " ")}
                  location={hostel.quarter_name}
                  mapsHref={
                    hostel.latitude && hostel.longitude
                      ? `https://www.google.com/maps/dir/?api=1&destination=${hostel.latitude},${hostel.longitude}`
                      : undefined
                  }
                  details={
                    roomTypes.length > 0 ? (
                      <>
                        <span>{tRooms("roomTypeCount", { count: roomTypes.length })}</span>
                        <span>{freePlaces > 0 ? tRooms("placesLeft", { count: freePlaces }) : tRooms("fullyBooked")}</span>
                      </>
                    ) : (
                    <>
                      {totalBeds > 0 && <span>🛏 {totalBeds} Total Beds</span>}
                      <span>
                        {hostel.units.length === 1
                          ? t("unitsAvailable", { count: hostel.units.length })
                          : t("unitsAvailableOther", { count: hostel.units.length })}
                      </span>
                    </>
                    )
                  }
                >
                  <div className="flex flex-wrap gap-1">
                    {roomTypes.length > 0
                      ? roomTypes.slice(0, 3).map((roomType) => (
                          <Badge key={roomType.id} variant="navy">{roomType.name}</Badge>
                        ))
                      : hostel.units.slice(0, 3).map((unit) => (
                          <Badge key={unit.id} variant="navy">
                            {unit.unit_type}
                          </Badge>
                        ))}
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    {hostel.owner ? (
                      <DirectChatButton
                        recipientId={hostel.owner}
                        recipientName={hostel.owner_name || "Hostel Warden"}
                        label="Message Warden"
                        className="inline-flex items-center gap-1.5 bg-slate-900 text-amber-300 font-semibold px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-800 transition-colors"
                      />
                    ) : (
                      <div />
                    )}
                    <JoinHostelWaitlistButton hostelId={hostel.id} />
                  </div>
                </AssetCard>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">{t("noHostelsYet")}</p>
          <div className="mt-6 p-6 rounded-2xl bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
            <div>
              <h4 className="font-bold text-base">{t("ownerCtaTitle")}</h4>
              <p className="text-xs text-slate-300 mt-1">{t("ownerCtaBody")}</p>
            </div>
            <Button onClick={() => setShowForm(true)} className="whitespace-nowrap shrink-0">
              {t("listYourHostel")}
            </Button>
          </div>
        </div>
      )}

    </main>
  );
}

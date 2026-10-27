"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { searchStudentHostels, createStudentHostel, addStudentHostelPhoto, listQuarters, type StudentHostel, type Quarter, type MediaUploadResult } from "@/lib/api";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import AssetCard from "@/components/AssetCard";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import MediaThumbs from "@/components/MediaThumbs";
import LocationCapture from "@/components/LocationCapture";
import InterestCaptureModal from "@/components/InterestCaptureModal";
import BookingCheckoutModal from "@/components/BookingCheckoutModal";
import JoinHostelWaitlistButton from "@/components/JoinHostelWaitlistButton";
import DirectChatButton from "@/components/DirectChatButton";
import {
  IconGraduationCap,
  IconMapPin,
  IconShieldCheck,
  IconLock,
  IconClock,
  IconSparkles,
  IconBuilding,
  IconCheckCircle,
} from "@/components/Icons";

const PROPERTY_TYPES = ["BLOCK", "SELF_CONTAIN_COMPOUND", "STUDIO_COMPLEX", "APARTMENT_BUILDING", "MIXED"] as const;

const SHOWCASE_HOSTELS = [
  {
    id: "showcase-sh1",
    name: "Molyko Campus Heights Residence",
    campus: "University of Buea (UB)",
    quarter_name: "Molyko, Buea",
    property_type: "STUDIO COMPLEX",
    rate_xaf: "45,000",
    unit_label: "per month",
    available_units: 4,
    photo_url: "https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=800&q=80",
    amenities: ["Borehole Water Tank", "High-Speed WiFi", "Fenced & Gated", "Prepaid Light Meter"],
  },
  {
    id: "showcase-sh2",
    name: "Ngoa-Ekellé University Hall",
    campus: "University of Yaoundé I (UY1)",
    quarter_name: "Ngoa-Ekellé / Melen, Yaoundé",
    property_type: "SELF-CONTAIN COMPOUND",
    rate_xaf: "60,000",
    unit_label: "per month",
    available_units: 6,
    photo_url: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80",
    amenities: ["5 Mins Walk to Faculty", "24/7 Security Guard", "Personal Balcony", "Water Included"],
  },
  {
    id: "showcase-sh3",
    name: "Ange Raphaël Academic Studios",
    campus: "University of Douala (ESSEC/Campus 1)",
    quarter_name: "Ange Raphaël, Douala",
    property_type: "STUDIO BLOCK",
    rate_xaf: "55,000",
    unit_label: "per month",
    available_units: 3,
    photo_url: "https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=800&q=80",
    amenities: ["Backup Generator", "Tiled Modern Finish", "Motorbike Access", "Gated Compound"],
  },
  {
    id: "showcase-sh4",
    name: "Dschang Student Oasis",
    campus: "University of Dschang",
    quarter_name: "Campus Principal, Dschang",
    property_type: "MIXED ROOM BLOCK",
    rate_xaf: "35,000",
    unit_label: "per month",
    available_units: 8,
    photo_url: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80",
    amenities: ["Quiet Study Area", "Water Borehole", "Installments Allowed", "Caretaker on-site"],
  },
];

export default function StudentHostelsPage() {
  const t = useTranslations("StudentHostelsPage");
  const [hostels, setHostels] = useState<StudentHostel[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

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

  // Live & Showcase Direct Escrow checkout state
  const [activeCheckout, setActiveCheckout] = useState<{
    title: string;
    quarter: string;
    price: number | string;
    targetId: string;
  } | null>(null);
  const [interestItem, setInterestItem] = useState<string | null>(null);

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
      window.location.href = "/login";
      return;
    }
    setSubmitStatus("submitting");
    try {
      const hostel = await createStudentHostel(
        {
          quarter: quarterId,
          property_type: propertyType,
          latitude: gpsCoords.latitude ?? undefined,
          longitude: gpsCoords.longitude ?? undefined,
        },
        token
      );
      for (const m of media) await addStudentHostelPhoto(hostel.id, m.url, m.media_type, token);
      setShowForm(false);
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
              <p className="text-red-600 text-xs md:col-span-2 font-medium">{t("submitFailed")}</p>
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
              const photo = hostel.photos?.find((p) => p.media_type === "PHOTO");
              return (
                <AssetCard
                  key={hostel.id}
                  href={`/student-hostels/${hostel.id}`}
                  photoUrl={photo?.url}
                  listerRole={hostel.lister_role}
                  listerRating={hostel.lister_average_rating}
                  listerRatingCount={hostel.lister_rating_count}
                  statusBadge={
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500 text-white">Verified Campus</span>
                  }
                  share={{ title: "student hostel", location: hostel.quarter_name, path: `/student-hostels/${hostel.id}` }}
                  typeLabel={hostel.property_type.replace(/_/g, " ")}
                  location={hostel.quarter_name}
                  mapsHref={
                    hostel.latitude && hostel.longitude
                      ? `https://www.google.com/maps/dir/?api=1&destination=${hostel.latitude},${hostel.longitude}`
                      : undefined
                  }
                  details={
                    <>
                      {totalBeds > 0 && <span>🛏 {totalBeds} Total Beds</span>}
                      <span>
                        {hostel.units.length === 1
                          ? t("unitsAvailable", { count: hostel.units.length })
                          : t("unitsAvailableOther", { count: hostel.units.length })}
                      </span>
                    </>
                  }
                >
                  <div className="flex flex-wrap gap-1">
                    {hostel.units.slice(0, 3).map((unit) => (
                      <Badge key={unit.id} variant="navy">
                        {unit.unit_type}
                      </Badge>
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      setActiveCheckout({
                        title: `Student Room • ${hostel.property_type.replace(/_/g, " ")}`,
                        quarter: hostel.quarter_name,
                        price: 45000,
                        targetId: hostel.id,
                      })
                    }
                    className="w-full text-xs font-black text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg transition-colors"
                  >
                    Reserve Room →
                  </button>
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
        /* Professional Showcase Cards when Database is empty */
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-[11px] font-bold uppercase tracking-wider text-indigo-800 mb-1">
                <IconSparkles size={12} />
                <span>Verified Campus Accommodation Preview</span>
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-slate-900">
                Top Student Residences Near Cameroonian Universities
              </h3>
            </div>
            <p className="text-xs text-slate-500 max-w-xs">
              Direct warden agreements ensure no surprise rents or illegal inspection fees.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
            {SHOWCASE_HOSTELS.map((item) => (
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
                      <span>Campus Partner</span>
                    </div>

                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/80 to-transparent p-3">
                      <p className="text-white text-base font-bold">
                        {item.rate_xaf} <span className="text-[11px] font-normal text-slate-200">XAF / {item.unit_label}</span>
                      </p>
                    </div>
                  </div>

                  <div className="p-4">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block mb-1">
                      {item.campus}
                    </span>

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
                      const matched = hostels.find((h) => h.quarter_name?.toLowerCase().includes(item.quarter_name.toLowerCase().split(",")[0]));
                      setActiveCheckout({
                        title: item.name,
                        quarter: item.quarter_name,
                        price: item.rate_xaf.replace(/,/g, ""),
                        targetId: matched ? matched.id : item.id,
                      });
                    }}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black transition-colors text-center shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5"
                  >
                    <IconLock size={13} />
                    <span>Reserve with Escrow Protection</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-base">Are You a Hostel Owner or Campus Landlord?</h4>
              <p className="text-xs text-slate-300 mt-1">
                Fill all your rooms before semester start. Receive direct student applications with automated escrow deposits.
              </p>
            </div>
            <Button onClick={() => setShowForm(true)} className="whitespace-nowrap shrink-0">
              {t("listYourHostel")}
            </Button>
          </div>
        </div>
      )}

      {activeCheckout && (
        <BookingCheckoutModal
          isOpen={true}
          onClose={() => setActiveCheckout(null)}
          bookingType="HOSTEL_SEMESTER"
          title={activeCheckout.title}
          quarterName={activeCheckout.quarter}
          priceXaf={activeCheckout.price}
          pricePeriodLabel="per month"
          targetId={activeCheckout.targetId}
          targetContentType="student_hostels.StudentHostel"
        />
      )}

      {interestItem && (
        <InterestCaptureModal itemName={interestItem} onClose={() => setInterestItem(null)} />
      )}
    </main>
  );
}

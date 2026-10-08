"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { editListingDetails, getListing, getMyProfile, type Listing } from "@/lib/api";
import LocationCapture, { type GpsValue } from "@/components/LocationCapture";

const AMENITIES = [
  "PARKING", "BACKUP_GENERATOR", "BOREHOLE_WATER_TANK", "SECURITY_24_7", "FENCED_COMPOUND", "SWIMMING_POOL",
  "AIR_CONDITIONING", "FURNISHED", "SOLAR_POWER", "CCTV", "BALCONY_TERRACE", "WIFI_READY",
];
const HOUSE_STYLES = ["ROOM", "STUDIO", "SELF_CONTAIN", "APARTMENT", "STANDARD", "DUPLEX", "BUNGALOW", "DETACHED_VILLA", "CHALET", "OTHER"];

const inputClass = "w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500";
const labelClass = "text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5";

export default function EditListingPage() {
  const t = useTranslations("EditListingPage");
  const tDetail = useTranslations("ListingDetailPage");
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [listing, setListing] = useState<Listing | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "missing">("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [price, setPrice] = useState("");
  const [listingType, setListingType] = useState("RENT");
  const [description, setDescription] = useState("");
  const [size, setSize] = useState("");
  const [finish, setFinish] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [livingRooms, setLivingRooms] = useState("");
  const [houseStyle, setHouseStyle] = useState("STANDARD");
  const [garage, setGarage] = useState(false);
  const [pets, setPets] = useState(false);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [gps, setGps] = useState<GpsValue>({ latitude: null, longitude: null });

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    Promise.all([getListing(id), token ? getMyProfile(token).catch(() => null) : Promise.resolve(null)])
      .then(([l, profile]) => {
        if (!profile || profile.id !== l.lister_id) {
          setState("forbidden");
          return;
        }
        const a = l.property_asset;
        setListing(l);
        setPrice(String(Number(l.price_xaf)));
        setListingType(l.listing_type);
        setDescription(a.description ?? "");
        setSize(a.size_sqm ? String(Number(a.size_sqm)) : "");
        setFinish(a.finish_level ?? "");
        setBedrooms(a.bedrooms !== null ? String(a.bedrooms) : "");
        setBathrooms(a.bathrooms !== null ? String(a.bathrooms) : "");
        setLivingRooms(a.living_rooms !== null ? String(a.living_rooms) : "");
        setHouseStyle(a.house_style ?? "STANDARD");
        setGarage(Boolean(a.has_garage));
        setPets(Boolean(a.pets_allowed));
        setAmenities(a.amenities ?? []);
        setGps({
          latitude: a.latitude ? Number(a.latitude) : null,
          longitude: a.longitude ? Number(a.longitude) : null,
        });
        setState("ready");
      })
      .catch(() => setState("missing"));
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !listing) return;
    setSaving(true);
    setError(null);
    const isHouse = listing.property_asset.bedrooms !== null;
    try {
      await editListingDetails(listing.id, {
        price_xaf: price,
        listing_type: listingType,
        description,
        size_sqm: size || null,
        ...(finish ? { finish_level: finish } : {}),
        amenities,
        latitude: gps.latitude,
        longitude: gps.longitude,
        ...(isHouse
          ? {
              bedrooms: Number(bedrooms || 0), bathrooms: Number(bathrooms || 0), living_rooms: Number(livingRooms || 0),
              house_style: houseStyle, has_garage: garage, pets_allowed: pets,
            }
          : {}),
      }, token);
      router.push(`/listing/${listing.id}`);
    } catch (err) {
      setError((err as Error).message || t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <main className="max-w-3xl mx-auto px-4 py-10 text-gray-400">{t("loading")}</main>;
  if (state === "missing") return <main className="max-w-3xl mx-auto px-4 py-10 text-gray-600">{t("notFound")}</main>;
  if (state === "forbidden") {
    return (
      <main className="max-w-3xl mx-auto px-4 py-10">
        <p className="text-gray-600 mb-4">{t("notAllowed")}</p>
        <Link href={`/listing/${id}`} className="text-sm font-semibold text-[var(--navy)] underline">{t("backToListing")}</Link>
      </main>
    );
  }

  const isHouse = listing?.property_asset.bedrooms !== null;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href={`/listing/${id}`} className="text-sm font-semibold text-[var(--navy)] hover:text-[var(--gold)] mb-4 inline-block">
        ← {t("backToListing")}
      </Link>
      <h1 className="text-2xl font-bold text-[var(--navy)] mb-1">{t("title")}</h1>
      <p className="text-sm text-gray-500 mb-6">{t("subtitle")}</p>

      <form onSubmit={handleSubmit} className="space-y-5 bg-white border border-gray-200 rounded-xl p-5 sm:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{t("price")}</label>
            <input required type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t("listingType")}</label>
            <select value={listingType} onChange={(e) => setListingType(e.target.value)} className={inputClass}>
              <option value="RENT">{t("rent")}</option>
              <option value="SALE">{t("sale")}</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{t("size")}</label>
            <input type="number" min={0} value={size} onChange={(e) => setSize(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t("finish")}</label>
            <select value={finish} onChange={(e) => setFinish(e.target.value)} className={inputClass}>
              <option value="">—</option>
              <option value="MODERN">{tDetail("finishModern")}</option>
              <option value="STANDARD">{tDetail("finishStandard")}</option>
            </select>
          </div>
        </div>

        {isHouse && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>{t("bedrooms")}</label>
              <input type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("bathrooms")}</label>
              <input type="number" min={0} value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("parlours")}</label>
              <input type="number" min={0} value={livingRooms} onChange={(e) => setLivingRooms(e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-3">
              <label className={labelClass}>{t("houseStyle")}</label>
              <select value={houseStyle} onChange={(e) => setHouseStyle(e.target.value)} className={inputClass}>
                {HOUSE_STYLES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={garage} onChange={(e) => setGarage(e.target.checked)} /> {t("garage")}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={pets} onChange={(e) => setPets(e.target.checked)} /> {t("pets")}
            </label>
          </div>
        )}

        <div>
          <label className={labelClass}>{t("description")}</label>
          <textarea rows={5} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>{t("amenities")}</label>
          <div className="flex flex-wrap gap-2">
            {AMENITIES.map((a) => {
              const on = amenities.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmenities((prev) => (on ? prev.filter((x) => x !== a) : [...prev, a]))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    on ? "bg-green-100 border-green-300 text-green-800" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {tDetail(`amenity_${a}`)}
                </button>
              );
            })}
          </div>
        </div>

        <LocationCapture value={gps} onChange={setGps} />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-xl gold-gradient text-[var(--navy)] font-bold text-sm disabled:opacity-60"
          >
            {saving ? t("saving") : t("save")}
          </button>
          <Link href={`/listing/${id}`} className="text-sm text-gray-500 hover:text-gray-700">{t("cancel")}</Link>
        </div>
      </form>
    </main>
  );
}

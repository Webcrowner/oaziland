"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createMarketplaceListing, updateMarketplaceListing, getMarketplaceListing, removeMarketplaceMedia, listQuarters,
  CAR_BODY_TYPES, CAR_FUEL_TYPES, CAR_TRANSMISSIONS, CAR_DRIVETRAINS, CAR_CONDITIONS, CAR_DRIVER_OPTIONS, CAR_FUEL_POLICIES, CAR_FEATURES,
  CAR_DAILY_BASIS, type CarListing, type Quarter, type MediaUploadResult, type MarketplaceMediaItem,
} from "@/lib/api";
import { finishMarketplacePost } from "@/lib/finishMarketplacePost";
import { EMPTY_CONDITIONS } from "@/components/MarketplaceConditionsFields";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import MediaThumbs from "@/components/MediaThumbs";
import LocationCapture, { EMPTY_GPS, type GpsValue } from "@/components/LocationCapture";
import SellGateNotice, { useSellGate } from "@/components/MarketplaceSellGate";
import { Link, useRouter } from "@/i18n/navigation";
import { listingErrorMessage } from "@/lib/marketplaceErrors";

/** Makes and models most often traded in Cameroon, offered as suggestions (any value can still be typed). */
const MAKE_MODELS: Record<string, string[]> = {
  Toyota: ["Corolla", "Camry", "RAV4", "Yaris", "Hilux", "Land Cruiser", "Prado", "Highlander", "Avensis", "Fortuner", "Hiace", "Rush"],
  "Mercedes-Benz": ["C-Class", "E-Class", "ML", "GLE", "GLK", "Sprinter", "Vito"],
  Hyundai: ["Elantra", "Tucson", "Santa Fe", "Accent", "i10", "Sonata", "H-1"],
  Kia: ["Picanto", "Rio", "Sportage", "Sorento", "Cerato"],
  Honda: ["Civic", "Accord", "CR-V", "Pilot", "Fit"],
  Nissan: ["Patrol", "Navara", "X-Trail", "Sunny", "Pathfinder", "Almera"],
  Mitsubishi: ["Pajero", "L200", "Outlander", "Lancer"],
  Peugeot: ["206", "301", "307", "308", "3008", "508", "Partner"],
  Renault: ["Clio", "Logan", "Duster", "Megane"],
  Ford: ["Ranger", "Explorer", "Focus", "Escape", "Transit"],
  Lexus: ["RX", "GX", "LX", "ES"],
  Suzuki: ["Swift", "Vitara", "Jimny", "Alto"],
  Volkswagen: ["Golf", "Passat", "Tiguan", "Touareg", "Polo"],
  BMW: ["3 Series", "5 Series", "X3", "X5"],
  Mazda: ["3", "6", "CX-5"],
  "Land Rover": ["Range Rover", "Range Rover Sport", "Discovery", "Defender"],
  Isuzu: ["D-Max", "NPR"],
  Chevrolet: ["Cruze", "Captiva"],
  Jeep: ["Grand Cherokee", "Wrangler"],
  Audi: ["A4", "A6", "Q5", "Q7"],
};
const MIN_PHOTOS = 4;
const PHOTO_SHOTS = ["shotFront", "shotBack", "shotLeft", "shotRight", "shotInterior", "shotDashboard", "shotEngine"] as const;
const STEPS = ["stepVehicle", "stepHistory", "stepPrice", "stepPhotos"] as const;

type TriState = "" | "yes" | "no";

interface Draft {
  forRent: boolean;
  make: string; model: string; year: string; trim: string; bodyType: string; fuelType: string; transmission: string; drivetrain: string;
  mileage: string; engine: string; exteriorColor: string; interiorColor: string; doors: string; seats: string;
  condition: string; customs: TriState; registration: TriState; owners: string; accidentFree: TriState; serviceHistory: TriState; vin: string;
  features: string[];
  price: string; negotiable: boolean; deposit: string; weeklyPct: string; monthlyPct: string; driverOption: string; driverFee: string;
  minDays: string; maxDays: string; kmLimit: string; extraKmFee: string; fuelPolicy: string; minAge: string; licenceYears: string;
  insurance: boolean; delivery: boolean; deliveryFee: string; outOfTown: boolean; instantBook: boolean;
  title: string; description: string; quarter: string;
}

const EMPTY: Draft = {
  forRent: false, make: "", model: "", year: "", trim: "", bodyType: "", fuelType: "", transmission: "", drivetrain: "",
  mileage: "", engine: "", exteriorColor: "", interiorColor: "", doors: "", seats: "",
  condition: "", customs: "", registration: "", owners: "", accidentFree: "", serviceHistory: "", vin: "", features: [],
  price: "", negotiable: false, deposit: "", weeklyPct: "", monthlyPct: "", driverOption: "SELF_DRIVE", driverFee: "",
  minDays: "1", maxDays: "", kmLimit: "", extraKmFee: "", fuelPolicy: "", minAge: "", licenceYears: "",
  insurance: false, delivery: false, deliveryFee: "", outOfTown: true, instantBook: true,
  title: "", description: "", quarter: "",
};

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));
const tri = (value: boolean | null | undefined): TriState => (value === true ? "yes" : value === false ? "no" : "");
const num = (value: string) => (value.trim() === "" ? null : Number(value));
const bool = (value: TriState) => (value === "" ? null : value === "yes");
const money = (value: string | null | undefined) => (value ? String(Number(value)) : "");

function draftFrom(car: CarListing): Draft {
  const s = car.vehicle_spec;
  return {
    forRent: car.price_basis !== "SALE",
    make: s.make, model: s.model, year: text(s.year), trim: text(s.trim), bodyType: text(s.body_type), fuelType: text(s.fuel_type),
    transmission: text(s.transmission), drivetrain: text(s.drivetrain), mileage: text(s.mileage_km), engine: text(s.engine_size_cc),
    exteriorColor: text(s.exterior_color), interiorColor: text(s.interior_color), doors: text(s.doors), seats: text(s.seats),
    condition: text(s.vehicle_condition), customs: tri(s.customs_cleared), registration: tri(s.registration_in_seller_name),
    owners: text(s.previous_owners), accidentFree: tri(s.accident_free), serviceHistory: tri(s.service_history), vin: text(s.vin),
    features: s.features ?? [],
    price: money(car.price_xaf), negotiable: Boolean(car.price_negotiable), deposit: money(car.security_deposit_xaf) === "0" ? "" : money(car.security_deposit_xaf),
    weeklyPct: car.weekly_discount_pct ? String(car.weekly_discount_pct) : "", monthlyPct: car.monthly_discount_pct ? String(car.monthly_discount_pct) : "",
    driverOption: car.driver_option ?? "SELF_DRIVE", driverFee: money(car.driver_fee_per_day_xaf) === "0" ? "" : money(car.driver_fee_per_day_xaf),
    minDays: text(car.min_rental_days ?? 1), maxDays: text(car.max_rental_days), kmLimit: text(car.daily_km_limit), extraKmFee: money(car.extra_km_fee_xaf),
    fuelPolicy: text(car.fuel_policy), minAge: text(car.min_driver_age), licenceYears: text(car.min_licence_years),
    insurance: Boolean(car.insurance_included), delivery: Boolean(car.delivery_available),
    deliveryFee: money(car.delivery_fee_xaf) === "0" ? "" : money(car.delivery_fee_xaf), outOfTown: car.out_of_town_allowed ?? true, instantBook: car.instant_book ?? true,
    title: car.title, description: car.description, quarter: car.quarter ?? "",
  };
}

function payloadFrom(d: Draft, gps: GpsValue): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: d.title.trim(), description: d.description, quarter: d.quarter || null, latitude: gps.latitude, longitude: gps.longitude,
    price_basis: d.forRent ? CAR_DAILY_BASIS : "SALE", price_xaf: d.price,
    security_deposit_xaf: d.forRent ? d.deposit || "0" : "0",
    vehicle_spec: {
      make: d.make.trim(), model: d.model.trim(), year: Number(d.year), trim: d.trim.trim(), body_type: d.bodyType, fuel_type: d.fuelType,
      transmission: d.transmission, drivetrain: d.drivetrain, mileage_km: num(d.mileage), engine_size_cc: num(d.engine),
      exterior_color: d.exteriorColor.trim(), interior_color: d.interiorColor.trim(), doors: num(d.doors), seats: num(d.seats),
      vehicle_condition: d.condition, customs_cleared: bool(d.customs), registration_in_seller_name: bool(d.registration),
      previous_owners: num(d.owners), accident_free: bool(d.accidentFree), service_history: bool(d.serviceHistory),
      features: d.features, vin: d.vin.trim(),
    },
  };
  if (!d.forRent) {
    payload.price_negotiable = d.negotiable;
    return payload;
  }
  return {
    ...payload,
    driver_option: d.driverOption, driver_fee_per_day_xaf: d.driverOption === "SELF_DRIVE" ? "0" : d.driverFee || "0",
    weekly_discount_pct: Number(d.weeklyPct) || 0, monthly_discount_pct: Number(d.monthlyPct) || 0,
    min_rental_days: Number(d.minDays) || 1, max_rental_days: num(d.maxDays),
    daily_km_limit: num(d.kmLimit), extra_km_fee_xaf: d.kmLimit && d.extraKmFee ? d.extraKmFee : null,
    fuel_policy: d.fuelPolicy, min_driver_age: num(d.minAge), min_licence_years: num(d.licenceYears),
    insurance_included: d.insurance, delivery_available: d.delivery, delivery_fee_xaf: d.delivery ? d.deliveryFee || "0" : "0",
    out_of_town_allowed: d.outOfTown, instant_book: d.instantBook,
  };
}

/**
 * Post (or edit, with editId) a car for sale or for rent by the day, in four steps like AutoTrader or Turo:
 * the vehicle, its history and features, the price and rental terms, then photos and location. Every spec is a
 * browse filter, so the more is filled in, the more searches the car shows up in.
 */
export default function CarListingForm({ editId }: { editId?: string }) {
  const t = useTranslations("CarListing");
  const tm = useTranslations("MarketplaceCategoryPage");
  const router = useRouter();
  const gate = useSellGate();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [step, setStep] = useState(0);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [gps, setGps] = useState<GpsValue>(EMPTY_GPS);
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [existing, setExisting] = useState<MarketplaceMediaItem[]>([]);
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [loadState, setLoadState] = useState<"ready" | "loading" | "failed">(editId ? "loading" : "ready");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const stepRef = useRef<HTMLFieldSetElement>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    listQuarters().then(setQuarters).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    getMarketplaceListing<CarListing>("cars", editId, localStorage.getItem("access_token"))
      .then((car) => {
        setDraft(draftFrom(car));
        setExisting(car.media);
        setGps({ latitude: car.latitude ? Number(car.latitude) : null, longitude: car.longitude ? Number(car.longitude) : null });
        setLoadState("ready");
      })
      .catch(() => setLoadState("failed"));
  }, [editId]);

  const keptExisting = existing.filter((m) => !removedIds.includes(m.id));
  const photoCount = keptExisting.filter((m) => m.media_type === "PHOTO").length + media.filter((m) => m.media_type === "PHOTO").length;
  const models = MAKE_MODELS[draft.make.trim()] ?? [];
  const suggestedTitle = [draft.year, draft.make.trim(), draft.model.trim(), draft.trim.trim()].filter(Boolean).join(" ");

  /** The current step's own native checks (required, min/max), shown on its first invalid field. */
  function stepIsValid(): boolean {
    const fields = stepRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea") ?? [];
    for (const field of Array.from(fields)) {
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
    return true;
  }

  function next() {
    setError("");
    if (!stepIsValid()) return;
    if (step === 2 && !draft.title.trim()) set({ title: suggestedTitle });
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!stepIsValid()) return;
    if (photoCount < MIN_PHOTOS) {
      setError(t("needPhotos", { count: MIN_PHOTOS }));
      return;
    }
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setSubmitting(true);
    try {
      const payload = payloadFrom(draft, gps);
      if (editId) {
        await updateMarketplaceListing("cars", editId, payload, token);
        for (const id of removedIds) await removeMarketplaceMedia("cars", editId, id, token).catch(() => {});
        router.push(await finishMarketplacePost("cars", editId, media, EMPTY_CONDITIONS, token));
      } else {
        const listing = await createMarketplaceListing("cars", payload, token);
        router.push(await finishMarketplacePost("cars", listing.id, media, EMPTY_CONDITIONS, token));
      }
    } catch (err) {
      setError(listingErrorMessage(err, tm("submitFailed")));
      setSubmitting(false);
    }
  }

  const field = "w-full border border-slate-300 rounded-lg px-3 py-2 bg-white text-sm focus:border-[var(--gold)] focus:outline-none";
  const label = "flex flex-col gap-1 text-sm font-medium text-slate-700";
  const triSelect = (key: "customs" | "registration" | "accidentFree" | "serviceHistory", title: string) => (
    <label className={label}>
      {title}
      <select value={draft[key]} onChange={(e) => set({ [key]: e.target.value as TriState } as Partial<Draft>)} className={field}>
        <option value="">{t("notSaying")}</option>
        <option value="yes">{t("yes")}</option>
        <option value="no">{t("no")}</option>
      </select>
    </label>
  );

  if (loadState === "loading") return <main className="max-w-4xl mx-auto px-4 py-8 text-slate-500">{t("loading")}</main>;
  if (loadState === "failed") return <main className="max-w-4xl mx-auto px-4 py-8 text-red-700" role="alert">{t("loadFailed")}</main>;

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <PageHeader
        title={editId ? t("editTitle") : tm("listACar")} subtitle={t("formSubtitle")}
        action={<Link href={editId ? `/marketplace/cars/${editId}` : "/marketplace/cars"} className="text-sm font-semibold text-[var(--navy)] underline">{tm("cancel")}</Link>}
      />
      {!editId && <SellGateNotice gate={gate} />}

      <ol className="mb-5 grid grid-cols-4 gap-2" aria-label={t("progress")}>
        {STEPS.map((key, index) => (
          <li key={key}>
            <button
              type="button" disabled={index > step} onClick={() => setStep(index)} aria-current={index === step ? "step" : undefined}
              className={`w-full rounded-lg border-t-4 px-1 pt-2 text-left text-xs font-semibold sm:text-sm ${index <= step ? "border-[var(--gold)] text-[var(--navy)]" : "border-slate-200 text-slate-400"}`}
            >
              <span className="block text-[11px] font-normal text-slate-500">{t("stepCount", { step: index + 1, total: STEPS.length })}</span>
              {t(key)}
            </button>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} noValidate className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <fieldset ref={stepRef} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {step === 0 && (
            <>
              <div className="sm:col-span-2">
                <p className="mb-2 text-sm font-medium text-slate-700">{t("offerType")}</p>
                <div className="grid grid-cols-2 gap-2" role="radiogroup">
                  {[false, true].map((rent) => (
                    <button
                      key={String(rent)} type="button" role="radio" aria-checked={draft.forRent === rent} onClick={() => set({ forRent: rent })}
                      className={`rounded-xl border-2 px-4 py-3 text-left ${draft.forRent === rent ? "border-[var(--navy)] bg-[var(--navy)]/5" : "border-slate-200"}`}
                    >
                      <span className="block font-semibold text-[var(--navy)]">{rent ? t("forRent") : t("forSale")}</span>
                      <span className="text-xs text-slate-500">{rent ? t("forRentHint") : t("forSaleHint")}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className={label}>
                {t("make")} *
                <input required list="car-makes" value={draft.make} onChange={(e) => set({ make: e.target.value })} className={field} autoComplete="off" />
                <datalist id="car-makes">{Object.keys(MAKE_MODELS).map((make) => <option key={make} value={make} />)}</datalist>
              </label>
              <label className={label}>
                {t("model")} *
                <input required list="car-models" value={draft.model} onChange={(e) => set({ model: e.target.value })} className={field} autoComplete="off" />
                <datalist id="car-models">{models.map((model) => <option key={model} value={model} />)}</datalist>
              </label>
              <label className={label}>
                {t("year")} *
                <input required type="number" min="1950" max={new Date().getFullYear() + 1} step="1" value={draft.year} onChange={(e) => set({ year: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("trim")}
                <input value={draft.trim} maxLength={60} onChange={(e) => set({ trim: e.target.value })} placeholder={t("trimPlaceholder")} className={field} />
              </label>
              <label className={label}>
                {t("bodyType")} *
                <select required value={draft.bodyType} onChange={(e) => set({ bodyType: e.target.value })} className={field}>
                  <option value="">{t("choose")}</option>
                  {CAR_BODY_TYPES.map((v) => <option key={v} value={v}>{t(`body_${v}`)}</option>)}
                </select>
              </label>
              <label className={label}>
                {t("fuelType")} *
                <select required value={draft.fuelType} onChange={(e) => set({ fuelType: e.target.value })} className={field}>
                  <option value="">{t("choose")}</option>
                  {CAR_FUEL_TYPES.map((v) => <option key={v} value={v}>{t(`fuel_${v}`)}</option>)}
                </select>
              </label>
              <label className={label}>
                {t("transmission")} *
                <select required value={draft.transmission} onChange={(e) => set({ transmission: e.target.value })} className={field}>
                  <option value="">{t("choose")}</option>
                  {CAR_TRANSMISSIONS.map((v) => <option key={v} value={v}>{t(`trans_${v}`)}</option>)}
                </select>
              </label>
              <label className={label}>
                {t("drivetrain")}
                <select value={draft.drivetrain} onChange={(e) => set({ drivetrain: e.target.value })} className={field}>
                  <option value="">{t("notSaying")}</option>
                  {CAR_DRIVETRAINS.map((v) => <option key={v} value={v}>{t(`drive_${v}`)}</option>)}
                </select>
              </label>
              <label className={label}>
                {t("mileage")} *
                <input required type="number" min="0" max="3000000" step="1" value={draft.mileage} onChange={(e) => set({ mileage: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("engine")}
                <input type="number" min="50" max="20000" step="1" value={draft.engine} onChange={(e) => set({ engine: e.target.value })} placeholder="1800" className={field} />
              </label>
              <label className={label}>
                {t("exteriorColor")}
                <input value={draft.exteriorColor} maxLength={30} onChange={(e) => set({ exteriorColor: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("interiorColor")}
                <input value={draft.interiorColor} maxLength={30} onChange={(e) => set({ interiorColor: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("doors")}
                <input type="number" min="1" max="6" step="1" value={draft.doors} onChange={(e) => set({ doors: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("seats")} *
                <input required type="number" min="1" max="80" step="1" value={draft.seats} onChange={(e) => set({ seats: e.target.value })} className={field} />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <label className={label}>
                {t("condition")} *
                <select required value={draft.condition} onChange={(e) => set({ condition: e.target.value })} className={field}>
                  <option value="">{t("choose")}</option>
                  {CAR_CONDITIONS.map((v) => <option key={v} value={v}>{t(`cond_${v}`)}</option>)}
                </select>
              </label>
              <label className={label}>
                {t("previousOwners")}
                <input type="number" min="0" max="30" step="1" value={draft.owners} onChange={(e) => set({ owners: e.target.value })} className={field} />
              </label>
              {triSelect("customs", t("customsCleared"))}
              {triSelect("registration", t("registration"))}
              {triSelect("accidentFree", t("accidentFree"))}
              {triSelect("serviceHistory", t("serviceHistory"))}
              <label className={`${label} sm:col-span-2`}>
                {t("vin")}
                <input
                  value={draft.vin} maxLength={17} pattern="[A-Za-z0-9\-]{6,17}" onChange={(e) => set({ vin: e.target.value.toUpperCase() })}
                  className={`${field} font-mono uppercase`} autoComplete="off"
                />
                <span className="text-xs font-normal text-slate-500">{t("vinHint")}</span>
              </label>
              <div className="sm:col-span-2">
                <p className="mb-2 text-sm font-medium text-slate-700">{t("features")}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {CAR_FEATURES.map((feature) => {
                    const on = draft.features.includes(feature);
                    return (
                      <label key={feature} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${on ? "border-[var(--navy)] bg-[var(--navy)]/5" : "border-slate-200"}`}>
                        <input
                          type="checkbox" checked={on}
                          onChange={() => set({ features: on ? draft.features.filter((f) => f !== feature) : [...draft.features, feature] })}
                        />
                        {t(`feat_${feature}`)}
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {step === 2 && !draft.forRent && (
            <>
              <label className={label}>
                {t("salePrice")} *
                <input required type="number" min="1" step="1" value={draft.price} onChange={(e) => set({ price: e.target.value })} className={field} />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                <input type="checkbox" checked={draft.negotiable} onChange={(e) => set({ negotiable: e.target.checked })} />
                {t("negotiable")}
              </label>
              <p className="text-xs text-slate-500 sm:col-span-2">{t("salePriceHint")}</p>
            </>
          )}

          {step === 2 && draft.forRent && (
            <>
              <label className={label}>
                {t("dailyRate")} *
                <input required type="number" min="1" step="1" value={draft.price} onChange={(e) => set({ price: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("deposit")}
                <input type="number" min="0" step="1" value={draft.deposit} onChange={(e) => set({ deposit: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("weeklyDiscount")}
                <input type="number" min="0" max="60" step="1" value={draft.weeklyPct} onChange={(e) => set({ weeklyPct: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("monthlyDiscount")}
                <input type="number" min="0" max="75" step="1" value={draft.monthlyPct} onChange={(e) => set({ monthlyPct: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("driverOption")}
                <select value={draft.driverOption} onChange={(e) => set({ driverOption: e.target.value })} className={field}>
                  {CAR_DRIVER_OPTIONS.map((v) => <option key={v} value={v}>{t(`driver_${v}`)}</option>)}
                </select>
              </label>
              {draft.driverOption !== "SELF_DRIVE" && (
                <label className={label}>
                  {t("driverFee")}
                  <input type="number" min="0" step="1" value={draft.driverFee} onChange={(e) => set({ driverFee: e.target.value })} className={field} />
                </label>
              )}
              <label className={label}>
                {t("minDays")}
                <input type="number" min="1" max="365" step="1" value={draft.minDays} onChange={(e) => set({ minDays: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("maxDays")}
                <input type="number" min={draft.minDays || "1"} max="365" step="1" value={draft.maxDays} onChange={(e) => set({ maxDays: e.target.value })} className={field} />
              </label>
              <label className={label}>
                {t("kmLimit")}
                <input type="number" min="10" max="5000" step="1" value={draft.kmLimit} onChange={(e) => set({ kmLimit: e.target.value })} placeholder={t("unlimited")} className={field} />
              </label>
              {draft.kmLimit && (
                <label className={label}>
                  {t("extraKmFee")}
                  <input type="number" min="0" step="1" value={draft.extraKmFee} onChange={(e) => set({ extraKmFee: e.target.value })} className={field} />
                </label>
              )}
              <label className={label}>
                {t("fuelPolicy")}
                <select value={draft.fuelPolicy} onChange={(e) => set({ fuelPolicy: e.target.value })} className={field}>
                  <option value="">{t("notSaying")}</option>
                  {CAR_FUEL_POLICIES.map((v) => <option key={v} value={v}>{t(`fuelPolicy_${v}`)}</option>)}
                </select>
              </label>
              {draft.driverOption !== "WITH_DRIVER" && (
                <>
                  <label className={label}>
                    {t("minAge")}
                    <input type="number" min="18" max="75" step="1" value={draft.minAge} onChange={(e) => set({ minAge: e.target.value })} className={field} />
                  </label>
                  <label className={label}>
                    {t("licenceYears")}
                    <input type="number" min="0" max="40" step="1" value={draft.licenceYears} onChange={(e) => set({ licenceYears: e.target.value })} className={field} />
                  </label>
                </>
              )}
              <div className="flex flex-col gap-2 sm:col-span-2">
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draft.instantBook} onChange={(e) => set({ instantBook: e.target.checked })} className="mt-1" />
                  <span>{t("instantBookOption")}<span className="block text-xs text-slate-500">{t("instantBookHint")}</span></span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draft.insurance} onChange={(e) => set({ insurance: e.target.checked })} /> {t("insuranceIncluded")}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draft.outOfTown} onChange={(e) => set({ outOfTown: e.target.checked })} /> {t("outOfTownAllowed")}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draft.delivery} onChange={(e) => set({ delivery: e.target.checked })} /> {t("deliveryAvailable")}
                </label>
              </div>
              {draft.delivery && (
                <label className={label}>
                  {t("deliveryFee")}
                  <input type="number" min="0" step="1" value={draft.deliveryFee} onChange={(e) => set({ deliveryFee: e.target.value })} className={field} />
                </label>
              )}
              <p className="text-xs text-slate-500 sm:col-span-2">{t("rentTermsHint")}</p>
            </>
          )}

          {step === 3 && (
            <>
              <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 sm:col-span-2">
                <p className="mb-2 font-semibold">{t("photoGuideTitle", { count: MIN_PHOTOS })}</p>
                <ul className="grid list-disc grid-cols-1 gap-x-6 gap-y-1 pl-5 sm:grid-cols-2">
                  {PHOTO_SHOTS.map((shot) => <li key={shot}>{t(shot)}</li>)}
                </ul>
                <p className="mt-2 text-xs">{t("photoGuideTips")}</p>
              </div>
              <div className="sm:col-span-2">
                <MediaUploader folder="marketplace" onUploaded={(m) => setMedia((prev) => [...prev, m])} label={tm("addPhotoOrVideo")} />
                <p className={`mt-1 text-xs font-semibold ${photoCount >= MIN_PHOTOS ? "text-green-700" : "text-amber-700"}`} aria-live="polite">
                  {t("photoProgress", { count: photoCount, min: MIN_PHOTOS })}
                </p>
                {keptExisting.length > 0 && (
                  <MediaThumbs
                    items={keptExisting.map((m) => ({ url: m.file_url, media_type: m.media_type }))}
                    onRemove={(i) => setRemovedIds((prev) => [...prev, keptExisting[i].id])}
                  />
                )}
                <MediaThumbs items={media.map((m) => ({ url: m.url, media_type: m.media_type }))} onRemove={(i) => setMedia((prev) => prev.filter((_, idx) => idx !== i))} />
              </div>
              <label className={`${label} sm:col-span-2`}>
                {t("listingTitle")} *
                <input required maxLength={200} value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder={suggestedTitle} className={field} />
              </label>
              <label className={`${label} sm:col-span-2`}>
                {t("description")}
                <textarea rows={6} value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder={draft.forRent ? t("descriptionRentPlaceholder") : t("descriptionSalePlaceholder")} className={field} />
              </label>
              <label className={`${label} sm:col-span-2`}>
                {t("location")} *
                <select required value={draft.quarter} onChange={(e) => set({ quarter: e.target.value })} className={field}>
                  <option value="" disabled>{tm("chooseNeighborhood")}</option>
                  <QuarterOptions quarters={quarters} />
                </select>
              </label>
              <MissingAreaRequest quarters={quarters} className="sm:col-span-2" />
              <LocationCapture className="sm:col-span-2" value={gps} onChange={setGps} />
            </>
          )}
        </fieldset>

        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex items-center justify-between gap-3">
          {step > 0 ? (
            <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
              {t("back")}
            </button>
          ) : <span />}
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>{t("next")}</Button>
          ) : (
            <Button size="lg" disabled={submitting || (!editId && gate !== "ready")}>
              {submitting ? tm("submitting") : editId ? t("saveChanges") : t("publish")}
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}

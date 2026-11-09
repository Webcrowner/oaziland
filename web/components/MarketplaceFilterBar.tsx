"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  GOODS_CATEGORIES, GOODS_CONDITIONS, CAR_BODY_TYPES, CAR_FUEL_TYPES, CAR_TRANSMISSIONS, CAR_CONDITIONS, CAR_DAILY_BASIS, type Quarter,
} from "@/lib/api";

export const MARKETPLACE_SORTS = ["newest", "price_asc", "price_desc", "oldest"] as const;
/** Sorts only the cars list understands. */
export const CAR_SORTS = ["year_desc", "year_asc", "mileage_asc"] as const;
export const MARKETPLACE_PRICE_BASES = ["SALE", "RENT_MONTHLY", "RENT_WEEKLY", "RENT_NIGHTLY", "RENT_ANNUAL"] as const;
export const NEAR_RADII_KM = ["5", "10", "25", "50", "100"] as const;

export interface MarketplaceFilters {
  q: string;
  ordering: string;
  priceBasis: string;
  minPrice: string;
  maxPrice: string;
  quarterId: string;
  minSizeSqm: string;
  itemCategory: string;
  condition: string;
  make: string;
  model: string;
  minYear: string;
  maxYear: string;
  maxMileageKm: string;
  bodyType: string;
  fuelType: string;
  transmission: string;
  carCondition: string;
  minSeats: string;
  customsCleared: boolean;
  withDriver: boolean;
  delivery: boolean;
  instantBook: boolean;
  availableFrom: string;
  availableTo: string;
  nearLat: string;
  nearLng: string;
  radiusKm: string;
}

export const EMPTY_MARKETPLACE_FILTERS: MarketplaceFilters = {
  q: "", ordering: "newest", priceBasis: "", minPrice: "", maxPrice: "", quarterId: "", minSizeSqm: "", itemCategory: "", condition: "",
  make: "", model: "", minYear: "", maxYear: "", maxMileageKm: "", nearLat: "", nearLng: "", radiusKm: "25",
  bodyType: "", fuelType: "", transmission: "", carCondition: "", minSeats: "", customsCleared: false, withDriver: false, delivery: false,
  instantBook: false, availableFrom: "", availableTo: "",
};

/** The car-only filters, cleared whenever the shopper leaves the Cars tab. */
export const EMPTY_CAR_FILTERS: Partial<MarketplaceFilters> = {
  make: "", model: "", minYear: "", maxYear: "", maxMileageKm: "", bodyType: "", fuelType: "", transmission: "", carCondition: "", minSeats: "",
  customsCleared: false, withDriver: false, delivery: false, instantBook: false, availableFrom: "", availableTo: "",
};

const carFiltersActive = (f: MarketplaceFilters) =>
  Boolean(f.bodyType || f.fuelType || f.transmission || f.carCondition || f.minSeats || f.customsCleared || f.withDriver || f.delivery || f.instantBook || f.availableFrom || f.model.trim());

/** The filters hidden behind the mobile "Filters" button — everything except the search box and sort order. */
const panelFiltersActive = (f: MarketplaceFilters) =>
  Boolean(f.priceBasis || f.minPrice || f.maxPrice || f.quarterId || f.minSizeSqm || f.itemCategory || f.condition || f.make.trim() || f.minYear || f.maxYear || f.maxMileageKm || f.nearLat || carFiltersActive(f));

/** True when anything beyond the default sort order is narrowing the results. */
export function filtersActive(f: MarketplaceFilters): boolean {
  return Boolean(f.q.trim()) || panelFiltersActive(f);
}

const QUERY_TEXT_FIELDS: [keyof MarketplaceFilters, string][] = [
  ["q", "q"], ["ordering", "ordering"], ["priceBasis", "price_basis"], ["minPrice", "min_price"], ["maxPrice", "max_price"],
  ["quarterId", "quarter_id"], ["minSizeSqm", "min_size_sqm"], ["itemCategory", "item_category"], ["condition", "condition"],
  ["make", "make"], ["model", "model"], ["minYear", "min_year"], ["maxYear", "max_year"], ["maxMileageKm", "max_mileage_km"],
  ["bodyType", "body_type"], ["fuelType", "fuel_type"], ["transmission", "transmission"], ["carCondition", "vehicle_condition"],
  ["minSeats", "min_seats"], ["availableFrom", "available_from"], ["availableTo", "available_to"],
];
const QUERY_FLAG_FIELDS: [keyof MarketplaceFilters, string][] = [
  ["customsCleared", "customs_cleared"], ["withDriver", "with_driver"], ["delivery", "delivery"], ["instantBook", "instant_book"],
];

/** The reverse of filtersToQuery: a saved search's (or a shared link's) query back into the filter state. */
export function queryToFilters(params: URLSearchParams | Record<string, string>): MarketplaceFilters {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : params[key]) ?? "";
  const filters = { ...EMPTY_MARKETPLACE_FILTERS } as Record<string, string | boolean>;
  for (const [field, key] of QUERY_TEXT_FIELDS) if (get(key)) filters[field] = get(key);
  for (const [field, key] of QUERY_FLAG_FIELDS) filters[field] = get(key) === "1";
  return filters as unknown as MarketplaceFilters;
}
/** Turns the filter state into the query params the marketplace API understands, dropping blanks. */
export function filtersToQuery(f: MarketplaceFilters): Record<string, string> {
  const query: Record<string, string> = { ordering: f.ordering };
  if (f.q.trim()) query.q = f.q.trim();
  if (f.priceBasis) query.price_basis = f.priceBasis;
  if (f.minPrice) query.min_price = f.minPrice;
  if (f.maxPrice) query.max_price = f.maxPrice;
  if (f.quarterId) query.quarter_id = f.quarterId;
  if (f.minSizeSqm) query.min_size_sqm = f.minSizeSqm;
  if (f.itemCategory) query.item_category = f.itemCategory;
  if (f.condition) query.condition = f.condition;
  if (f.make.trim()) query.make = f.make.trim();
  if (f.model.trim()) query.model = f.model.trim();
  if (f.minYear) query.min_year = f.minYear;
  if (f.maxYear) query.max_year = f.maxYear;
  if (f.maxMileageKm) query.max_mileage_km = f.maxMileageKm;
  if (f.bodyType) query.body_type = f.bodyType;
  if (f.fuelType) query.fuel_type = f.fuelType;
  if (f.transmission) query.transmission = f.transmission;
  if (f.carCondition) query.vehicle_condition = f.carCondition;
  if (f.minSeats) query.min_seats = f.minSeats;
  if (f.customsCleared) query.customs_cleared = "1";
  if (f.withDriver) query.with_driver = "1";
  if (f.delivery) query.delivery = "1";
  if (f.instantBook) query.instant_book = "1";
  // Free dates only make sense for rentals and need both ends.
  if (f.availableFrom && f.availableTo && f.availableTo > f.availableFrom) {
    query.available_from = f.availableFrom;
    query.available_to = f.availableTo;
  }
  if (f.nearLat && f.nearLng) {
    query.near_lat = f.nearLat;
    query.near_lng = f.nearLng;
    query.radius_km = f.radiusKm;
  } else if (f.ordering === "distance") {
    query.ordering = "newest";
  }
  return query;
}

/**
 * Search box and sort order are always visible; the remaining filters sit in a panel that is collapsed on
 * phones (behind a "Filters" button with an active-count badge) and always open from the md breakpoint up.
 */
export default function MarketplaceFilterBar({
  value, onChange, showPriceBasis = true, showMinSize = false, showGoodsFilters = false, showCarFilters = false, quarters = [],
}: {
  value: MarketplaceFilters;
  onChange: (next: MarketplaceFilters) => void;
  showPriceBasis?: boolean;
  showMinSize?: boolean;
  showGoodsFilters?: boolean;
  showCarFilters?: boolean;
  quarters?: Quarter[];
}) {
  const t = useTranslations("MarketplaceFilters");
  const tg = useTranslations("MarketplaceGoods");
  const tc = useTranslations("CarListing");
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const set = (patch: Partial<MarketplaceFilters>) => onChange({ ...value, ...patch });

  // The position is only sent as search parameters; nothing about it is stored.
  function toggleNearMe() {
    setLocationError("");
    if (value.nearLat) {
      set({ nearLat: "", nearLng: "", ordering: value.ordering === "distance" ? "newest" : value.ordering });
      return;
    }
    if (!navigator.geolocation) {
      setLocationError(t("locationUnsupported"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ ...value, nearLat: pos.coords.latitude.toFixed(5), nearLng: pos.coords.longitude.toFixed(5), ordering: "distance" });
      },
      (err) => {
        setLocating(false);
        setLocationError(err.code === err.PERMISSION_DENIED ? t("locationDenied") : t("locationFailed"));
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  }
  const field = "w-full min-w-0 border border-slate-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:border-[var(--gold)] focus:outline-none";
  const activeCount = [value.priceBasis, value.minPrice, value.maxPrice, value.quarterId, value.minSizeSqm, value.itemCategory, value.condition, value.make.trim(), value.minYear, value.maxYear, value.maxMileageKm, value.nearLat,
    value.bodyType, value.fuelType, value.transmission, value.carCondition, value.minSeats, value.customsCleared, value.withDriver, value.delivery, value.instantBook, value.availableFrom, value.model.trim(),
  ].filter(Boolean).length;

  return (
    <div className="mb-5" role="search">
      <div className="flex gap-2">
        <input
          type="search" value={value.q} onChange={(e) => set({ q: e.target.value })}
          placeholder={t("search")} aria-label={t("search")} className={`${field} flex-1`}
        />
        <button
          type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className="md:hidden shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700"
        >
          {t("filters")}
          {activeCount > 0 && <span className="rounded-full bg-[var(--gold)] px-1.5 text-xs text-[var(--navy)]">{activeCount}</span>}
        </button>
      </div>

      <div className={`${open ? "grid" : "hidden"} md:grid grid-cols-2 md:grid-cols-4 items-end gap-2.5 mt-2.5`}>
        {showGoodsFilters && (
          <>
            <select value={value.itemCategory} onChange={(e) => set({ itemCategory: e.target.value })} aria-label={t("itemCategory")} className={field}>
              <option value="">{t("anyItemCategory")}</option>
              {GOODS_CATEGORIES.map((c) => <option key={c} value={c}>{tg(`cat_${c}`)}</option>)}
            </select>
            <select value={value.condition} onChange={(e) => set({ condition: e.target.value })} aria-label={t("condition")} className={field}>
              <option value="">{t("anyCondition")}</option>
              {GOODS_CONDITIONS.map((c) => <option key={c} value={c}>{tg(`cond_${c}`)}</option>)}
            </select>
          </>
        )}
        {showCarFilters && (
          <>
            <input type="search" value={value.make} onChange={(e) => set({ make: e.target.value })} placeholder={t("make")} aria-label={t("make")} className={field} />
            <input type="search" value={value.model} onChange={(e) => set({ model: e.target.value })} placeholder={t("model")} aria-label={t("model")} className={field} />
            <input type="number" inputMode="numeric" min="1900" value={value.minYear} onChange={(e) => set({ minYear: e.target.value })} placeholder={t("minYear")} aria-label={t("minYear")} className={field} />
            <input type="number" inputMode="numeric" min="1900" value={value.maxYear} onChange={(e) => set({ maxYear: e.target.value })} placeholder={t("maxYear")} aria-label={t("maxYear")} className={field} />
            <input type="number" inputMode="numeric" min="0" value={value.maxMileageKm} onChange={(e) => set({ maxMileageKm: e.target.value })} placeholder={t("maxMileage")} aria-label={t("maxMileage")} className={field} />
            <select
              value={value.priceBasis} aria-label={t("carOffer")} className={field}
              onChange={(e) => set({ priceBasis: e.target.value, ...(e.target.value === "SALE" ? { withDriver: false, delivery: false, instantBook: false, availableFrom: "", availableTo: "" } : {}) })}
            >
              <option value="">{t("carOfferAny")}</option>
              <option value="SALE">{t("carOfferSale")}</option>
              <option value={CAR_DAILY_BASIS}>{t("carOfferRent")}</option>
            </select>
            <select value={value.bodyType} onChange={(e) => set({ bodyType: e.target.value })} aria-label={tc("bodyType")} className={field}>
              <option value="">{t("anyBodyType")}</option>
              {CAR_BODY_TYPES.map((v) => <option key={v} value={v}>{tc(`body_${v}`)}</option>)}
            </select>
            <select value={value.fuelType} onChange={(e) => set({ fuelType: e.target.value })} aria-label={tc("fuelType")} className={field}>
              <option value="">{t("anyFuel")}</option>
              {CAR_FUEL_TYPES.map((v) => <option key={v} value={v}>{tc(`fuel_${v}`)}</option>)}
            </select>
            <select value={value.transmission} onChange={(e) => set({ transmission: e.target.value })} aria-label={tc("transmission")} className={field}>
              <option value="">{t("anyTransmission")}</option>
              {CAR_TRANSMISSIONS.map((v) => <option key={v} value={v}>{tc(`trans_${v}`)}</option>)}
            </select>
            <select value={value.carCondition} onChange={(e) => set({ carCondition: e.target.value })} aria-label={tc("condition")} className={field}>
              <option value="">{t("anyCarCondition")}</option>
              {CAR_CONDITIONS.map((v) => <option key={v} value={v}>{tc(`cond_${v}`)}</option>)}
            </select>
            <input type="number" inputMode="numeric" min="1" value={value.minSeats} onChange={(e) => set({ minSeats: e.target.value })} placeholder={t("minSeats")} aria-label={t("minSeats")} className={field} />
            <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
              <input type="checkbox" checked={value.customsCleared} onChange={(e) => set({ customsCleared: e.target.checked })} /> {t("customsCleared")}
            </label>
            {value.priceBasis === CAR_DAILY_BASIS && (
              <>
                <label className="flex flex-col text-[11px] font-semibold text-slate-500">
                  {t("availableFrom")}
                  <input type="date" value={value.availableFrom} onChange={(e) => set({ availableFrom: e.target.value })} className={field} />
                </label>
                <label className="flex flex-col text-[11px] font-semibold text-slate-500">
                  {t("availableTo")}
                  <input type="date" min={value.availableFrom || undefined} value={value.availableTo} onChange={(e) => set({ availableTo: e.target.value })} className={field} />
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
                  <input type="checkbox" checked={value.withDriver} onChange={(e) => set({ withDriver: e.target.checked })} /> {t("withDriver")}
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
                  <input type="checkbox" checked={value.delivery} onChange={(e) => set({ delivery: e.target.checked })} /> {t("delivery")}
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700">
                  <input type="checkbox" checked={value.instantBook} onChange={(e) => set({ instantBook: e.target.checked })} /> {t("instantBook")}
                </label>
              </>
            )}
          </>
        )}
        {showPriceBasis && (
          <select value={value.priceBasis} onChange={(e) => set({ priceBasis: e.target.value })} aria-label={t("priceBasis")} className={field}>
            <option value="">{t("anyPriceBasis")}</option>
            {MARKETPLACE_PRICE_BASES.map((b) => <option key={b} value={b}>{t(`basis_${b}`)}</option>)}
          </select>
        )}
        <input type="number" inputMode="numeric" min="0" value={value.minPrice} onChange={(e) => set({ minPrice: e.target.value })} placeholder={t("minPrice")} aria-label={t("minPrice")} className={field} />
        <input type="number" inputMode="numeric" min="0" value={value.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} placeholder={t("maxPrice")} aria-label={t("maxPrice")} className={field} />
        <select value={value.quarterId} onChange={(e) => set({ quarterId: e.target.value })} aria-label={t("neighborhood")} className={field}>
          <option value="">{t("anyNeighborhood")}</option>
          {quarters.map((quarter) => <option key={quarter.id} value={quarter.id}>{quarter.name}</option>)}
        </select>
        {showMinSize && (
          <input type="number" inputMode="numeric" min="0" value={value.minSizeSqm} onChange={(e) => set({ minSizeSqm: e.target.value })} placeholder={t("minSize")} aria-label={t("minSize")} className={field} />
        )}
        <button
          type="button" onClick={toggleNearMe} disabled={locating} aria-pressed={Boolean(value.nearLat)}
          className={`w-full min-w-0 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold ${value.nearLat ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-slate-300 bg-white text-slate-700"}`}
        >
          📍 {locating ? t("locating") : t("nearMe")}
        </button>
        {value.nearLat && (
          <select value={value.radiusKm} onChange={(e) => set({ radiusKm: e.target.value })} aria-label={t("radius")} className={field}>
            {NEAR_RADII_KM.map((km) => <option key={km} value={km}>{t("withinKm", { km })}</option>)}
          </select>
        )}
        <select value={value.ordering} onChange={(e) => set({ ordering: e.target.value })} aria-label={t("sortBy")} className={field}>
          {MARKETPLACE_SORTS.map((s) => <option key={s} value={s}>{t(`sort_${s}`)}</option>)}
          {showCarFilters && CAR_SORTS.map((s) => <option key={s} value={s}>{t(`sort_${s}`)}</option>)}
          {value.nearLat && <option value="distance">{t("sort_distance")}</option>}
        </select>
        {locationError && <p role="alert" className="col-span-2 md:col-span-4 text-sm text-red-700">{locationError}</p>}
        {panelFiltersActive(value) && (
          <button
            type="button" onClick={() => onChange({ ...EMPTY_MARKETPLACE_FILTERS, q: value.q, ordering: value.ordering === "distance" ? "newest" : value.ordering })}
            className="col-span-2 md:col-span-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-[var(--navy)] underline"
          >
            {t("clearFilters")}
          </button>
        )}
      </div>
    </div>
  );
}

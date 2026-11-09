import { getTranslations } from "next-intl/server";
import type { CarListing } from "@/lib/api";

/** A car's spec sheet the way AutoTrader/Cars.com lay it out: overview, history and papers, features, and for a
 * rental car the owner's terms (Turo style). Unknown values are simply left out. */
export async function CarSpecSheet({ car }: { car: CarListing }) {
  const t = await getTranslations("CarListing");
  const s = car.vehicle_spec;
  const yesNo = (value: boolean | null | undefined) => (value === true ? t("yes") : value === false ? t("no") : null);
  const xaf = (value: string | null | undefined) => `${Number(value ?? 0).toLocaleString()} XAF`;

  const overview: [string, string | null][] = [
    [t("make"), `${s.make} ${s.model}${s.trim ? ` ${s.trim}` : ""}`],
    [t("year"), String(s.year)],
    [t("mileage"), s.mileage_km != null ? `${s.mileage_km.toLocaleString()} km` : null],
    [t("bodyType"), s.body_type ? t(`body_${s.body_type}`) : null],
    [t("fuelType"), s.fuel_type ? t(`fuel_${s.fuel_type}`) : null],
    [t("transmission"), s.transmission ? t(`trans_${s.transmission}`) : null],
    [t("drivetrain"), s.drivetrain ? t(`drive_${s.drivetrain}`) : null],
    [t("engine"), s.engine_size_cc ? `${s.engine_size_cc.toLocaleString()} cc` : null],
    [t("seats"), s.seats ? String(s.seats) : null],
    [t("doors"), s.doors ? String(s.doors) : null],
    [t("exteriorColor"), s.exterior_color || null],
    [t("interiorColor"), s.interior_color || null],
  ];
  const history: [string, string | null][] = [
    [t("condition"), s.vehicle_condition ? t(`cond_${s.vehicle_condition}`) : null],
    [t("customsCleared"), yesNo(s.customs_cleared)],
    [t("registration"), yesNo(s.registration_in_seller_name)],
    [t("previousOwners"), s.previous_owners != null ? String(s.previous_owners) : null],
    [t("accidentFree"), yesNo(s.accident_free)],
    [t("serviceHistory"), yesNo(s.service_history)],
    [t("vin"), s.vin || s.vin_last6 || null],
  ];
  const isRent = car.price_basis !== "SALE";
  const terms: [string, string | null][] = isRent ? [
    [t("booking"), car.instant_book === false ? t("bookingRequest") : t("bookingInstant")],
    [t("driverOption"), car.driver_option ? t(`driver_${car.driver_option}`) : null],
    [t("driverFeeShort"), car.driver_option && car.driver_option !== "SELF_DRIVE" && Number(car.driver_fee_per_day_xaf) > 0 ? `${xaf(car.driver_fee_per_day_xaf)} ${t("perDay")}` : null],
    [t("rentalLength"), car.max_rental_days ? t("daysRange", { min: car.min_rental_days ?? 1, max: car.max_rental_days }) : t("daysMin", { min: car.min_rental_days ?? 1 })],
    [t("discounts"), [
      car.weekly_discount_pct ? t("weeklyOff", { pct: car.weekly_discount_pct }) : "",
      car.monthly_discount_pct ? t("monthlyOff", { pct: car.monthly_discount_pct }) : "",
    ].filter(Boolean).join(" · ") || null],
    [t("kmLimit"), car.daily_km_limit ? `${t("kmPerDay", { km: car.daily_km_limit.toLocaleString() })}${car.extra_km_fee_xaf ? ` · ${t("extraKm", { fee: xaf(car.extra_km_fee_xaf) })}` : ""}` : t("unlimited")],
    [t("fuelPolicy"), car.fuel_policy ? t(`fuelPolicy_${car.fuel_policy}`) : null],
    [t("requirements"), car.driver_option !== "WITH_DRIVER" && (car.min_driver_age || car.min_licence_years)
      ? [car.min_driver_age ? t("minAgeValue", { age: car.min_driver_age }) : "", car.min_licence_years ? t("licenceValue", { years: car.min_licence_years }) : ""].filter(Boolean).join(" · ")
      : null],
    [t("insurance"), car.insurance_included ? t("insuranceIncluded") : t("insuranceNotIncluded")],
    [t("delivery"), car.delivery_available ? (Number(car.delivery_fee_xaf) > 0 ? xaf(car.delivery_fee_xaf) : t("freeDelivery")) : t("pickupOnly")],
    [t("outOfTown"), car.out_of_town_allowed === false ? t("cityOnly") : t("outOfTownOk")],
  ] : [];

  const table = (title: string, rows: [string, string | null][]) => {
    const shown = rows.filter((row): row is [string, string] => Boolean(row[1]));
    if (shown.length === 0) return null;
    return (
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">{title}</h2>
        <dl className="grid grid-cols-1 overflow-hidden rounded-lg border border-gray-200 sm:grid-cols-2">
          {shown.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-gray-100 px-3 py-2 text-sm">
              <dt className="text-gray-500">{label}</dt>
              <dd className="text-right font-semibold text-[var(--navy)]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  };

  return (
    <>
      {table(t("overview"), overview)}
      {table(t("historyPapers"), history)}
      {(s.features ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">{t("features")}</h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-700 sm:grid-cols-3">
            {(s.features ?? []).map((f) => <li key={f}>✓ {t(`feat_${f}`)}</li>)}
          </ul>
        </section>
      )}
      {isRent && table(t("rentalTerms"), terms)}
    </>
  );
}

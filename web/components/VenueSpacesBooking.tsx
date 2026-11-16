"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Venue } from "@/lib/api";
import VenueBookingModal from "@/components/VenueBookingModal";

/** A venue's event spaces with capacities, hourly price and a Book button each. */
export default function VenueSpacesBooking({ venue }: { venue: Venue }) {
  const t = useTranslations("VenueSpacesBooking");
  const tDetail = useTranslations("AssetDetail");
  const locale = useLocale();
  const [spaceId, setSpaceId] = useState<string | null>(null);

  if (venue.spaces.length === 0) return null;

  return (
    <section className="mb-6" aria-labelledby="venue-spaces-heading">
      <h2 id="venue-spaces-heading" className="text-sm font-semibold text-gray-700 mb-2">{tDetail("eventSpaces")}</h2>
      <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
        {venue.spaces.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
            <div>
              <p className="font-semibold text-[var(--navy)]">{s.space_name}</p>
              <p className="text-gray-500 text-xs mt-0.5">
                {[
                  s.capacity_theatre ? `${s.capacity_theatre} ${tDetail("theatre")}` : "",
                  s.capacity_banquet ? `${s.capacity_banquet} ${tDetail("banquet")}` : "",
                  s.capacity_cocktail ? `${s.capacity_cocktail} ${tDetail("cocktail")}` : "",
                  s.capacity_classroom ? `${s.capacity_classroom} ${tDetail("classroom")}` : "",
                  s.catering_policy ? s.catering_policy.replace(/_/g, " ").toLowerCase() : "",
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <p className="font-bold text-gray-900 whitespace-nowrap">
                {t("perHour", { price: new Intl.NumberFormat(locale).format(Number(s.base_price_per_hour_xaf)) })}
              </p>
              <button
                type="button"
                onClick={() => setSpaceId(s.id)}
                className="rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-black text-slate-950 shadow-sm hover:bg-amber-600"
              >
                {t("book")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-500">{t("escrowNote")}</p>
      {spaceId && <VenueBookingModal venue={venue} initialSpaceId={spaceId} onClose={() => setSpaceId(null)} />}
    </section>
  );
}

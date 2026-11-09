"use client";
import { useTranslations } from "next-intl";
import type { RideBookingItem } from "@/lib/api";

/** What the rider said about their luggage — count, size and photos — so the driver can judge if it fits. */
export default function LuggageDetails({ ride }: { ride: Pick<RideBookingItem, "has_luggage" | "luggage_count" | "luggage_size" | "luggage_photo_urls"> }) {
  const t = useTranslations("OaziGoPage");
  if (!ride.has_luggage) return null;
  const facts = [
    ride.luggage_count ? t("luggageCountValue", { count: ride.luggage_count }) : "",
    ride.luggage_size ? t(`luggageSize_${ride.luggage_size}`) : "",
  ].filter(Boolean);
  const photos = ride.luggage_photo_urls ?? [];

  return (
    <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
      <p className="text-xs font-bold text-slate-700">🧳 {t("hasLuggageLabel")}{facts.length > 0 && <span className="font-semibold text-slate-500"> · {facts.join(" · ")}</span>}</p>
      {photos.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("luggagePhotosLabel")}>
          {photos.map((url, i) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-slate-200 hover:ring-2 hover:ring-amber-400">
                {/* eslint-disable-next-line @next/next/no-img-element -- rider uploads from arbitrary storage hosts */}
                <img src={url} alt={t("luggagePhotoAlt", { n: i + 1 })} className="h-20 w-20 object-cover" loading="lazy" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

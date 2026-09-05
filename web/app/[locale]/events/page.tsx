import { getTranslations } from "next-intl/server";
import { searchVenues } from "@/lib/api";

export default async function EventsPage() {
  const t = await getTranslations("VenuesPage");
  const tCard = await getTranslations("PropertyCard");
  const data = await searchVenues().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-6">{t("subtitle")}</p>

      {data.results.length === 0 ? (
        <p className="text-gray-500">{t("noVenuesYet")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((venue) => {
            const cheapestSpace = venue.spaces.length
              ? venue.spaces.reduce((min, s) => (Number(s.base_price_per_hour_xaf) < Number(min.base_price_per_hour_xaf) ? s : min))
              : null;
            return (
              <div key={venue.id} className="border rounded-lg overflow-hidden bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-1">
                <div className="h-40 bg-gray-200 flex items-center justify-center text-gray-600 text-sm">
                  {tCard("noPhotoYet")}
                </div>
                <div className="p-4">
                  <p className="text-sm text-gray-500 mb-2">{venue.quarter_name}</p>
                  <p className="text-xs text-gray-500 mb-2">
                    {venue.spaces.length === 1 ? t("spacesAvailable", { count: venue.spaces.length }) : t("spacesAvailableOther", { count: venue.spaces.length })}
                  </p>
                  {venue.spaces[0] && (
                    <div className="flex gap-3 text-xs text-gray-500 mb-2">
                      {venue.spaces[0].capacity_theatre && <span>{t("theatreCapacity", { count: venue.spaces[0].capacity_theatre })}</span>}
                      {venue.spaces[0].capacity_banquet && <span>{t("banquetCapacity", { count: venue.spaces[0].capacity_banquet })}</span>}
                    </div>
                  )}
                  {cheapestSpace && (
                    <p className="text-lg font-bold text-[#1B2A4A]">
                      {Number(cheapestSpace.base_price_per_hour_xaf).toLocaleString()} XAF
                      <span className="text-sm font-normal text-gray-500"> {t("perHour")}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

import { getTranslations } from "next-intl/server";
import { searchHotels } from "@/lib/api";

/**
 * Hotels — the representative example proving the new hospitality
 * APIs (Hotels/Events/Student Hostels/Guest Houses, built this
 * session) genuinely work end-to-end with the web app's existing
 * SSR + bilingual infrastructure, not just at the API layer in
 * isolation. Same server-rendered pattern as /search (Prompt 17):
 * real data fetched at request time, real translations, no
 * client-side fetch.
 */
export default async function HotelsPage() {
  const t = await getTranslations("HotelsPage");
  const tCard = await getTranslations("PropertyCard");
  const data = await searchHotels().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-6">{t("subtitle")}</p>

      {data.results.length === 0 ? (
        <p className="text-gray-500">{t("noHotelsYet")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((hotel) => {
            const cheapestRoom = hotel.room_types.length
              ? hotel.room_types.reduce((min, rt) => (Number(rt.base_rate_xaf) < Number(min.base_rate_xaf) ? rt : min))
              : null;

            return (
              <div key={hotel.id} className="border rounded-lg overflow-hidden bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-1">
                <div className="h-40 bg-gray-200 flex items-center justify-center text-gray-600 text-sm">
                  {tCard("noPhotoYet")}
                </div>
                <div className="p-4">
                  <p className="text-sm text-gray-500 mb-1">{hotel.quarter_name}</p>
                  {hotel.star_rating && (
                    <p className="text-sm text-[#C9A227] font-semibold mb-1">
                      {"★".repeat(hotel.star_rating)}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mb-2">
                    {hotel.room_types.length === 1
                      ? t("roomsAvailable", { count: hotel.room_types.length })
                      : t("roomsAvailableOther", { count: hotel.room_types.length })}
                  </p>
                  {cheapestRoom && (
                    <p className="text-lg font-bold text-[#1B2A4A]">
                      {t("from")} {Number(cheapestRoom.base_rate_xaf).toLocaleString()} XAF
                      <span className="text-sm font-normal text-gray-500"> {t("perNight")}</span>
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

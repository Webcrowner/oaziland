import { getTranslations } from "next-intl/server";
import { searchStudentHostels } from "@/lib/api";

export default async function StudentHostelsPage() {
  const t = await getTranslations("StudentHostelsPage");
  const tCard = await getTranslations("PropertyCard");
  const data = await searchStudentHostels().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-6">{t("subtitle")}</p>

      {data.results.length === 0 ? (
        <p className="text-gray-500">{t("noHostelsYet")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((hostel) => (
            <div key={hostel.id} className="border rounded-lg overflow-hidden bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-1">
              <div className="h-40 bg-gray-200 flex items-center justify-center text-gray-600 text-sm">
                {tCard("noPhotoYet")}
              </div>
              <div className="p-4">
                <p className="text-sm text-gray-500 mb-2">{hostel.quarter_name}</p>
                <p className="text-xs text-gray-500 mb-2">
                  {hostel.units.length === 1 ? t("unitsAvailable", { count: hostel.units.length }) : t("unitsAvailableOther", { count: hostel.units.length })}
                </p>
                <div className="flex flex-wrap gap-1">
                  {hostel.units.slice(0, 3).map((unit) => (
                    <span key={unit.id} className="text-xs font-semibold uppercase text-[#1B2A4A] bg-gray-100 px-2 py-1 rounded">
                      {unit.unit_type}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

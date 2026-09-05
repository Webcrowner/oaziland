import { getTranslations } from "next-intl/server";
import { listAgencies } from "@/lib/api";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Nos Agences Immobilières | Oaziland" : "Our Real Estate Agencies | Oaziland",
    description: locale === "fr" ? "Des agences immobilières enregistrées à travers le Cameroun." : "Registered real estate agencies across Cameroon.",
  };
}

export default async function AgenciesDirectoryPage() {
  const t = await getTranslations("AgenciesDirectoryPage");
  const data = await listAgencies().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-8">{t("subtitle")}</p>

      {data.results.length === 0 ? (
        <p className="text-gray-500">{t("noAgenciesYet")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((agency) => (
            <div key={agency.agency_id} className="border rounded-lg p-4 bg-white transition-shadow hover:shadow-md">
              <p className="font-semibold text-[#1B2A4A] mb-1">{agency.agency_name}</p>
              <p className="text-xs text-gray-500 mb-3">{agency.registration_number}</p>
              <p className="text-sm text-gray-600">
                {agency.agent_count === 1 ? t("agentsCount", { count: agency.agent_count }) : t("agentsCountOther", { count: agency.agent_count })}
              </p>
              {agency.average_rating && (
                <p className="text-[#C9A227] font-semibold text-sm mt-2">★ {agency.average_rating} ({agency.rating_count})</p>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

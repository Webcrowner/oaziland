import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listAgents } from "@/lib/api";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Nos Agents Immobiliers | Oaziland" : "Our Real Estate Agents | Oaziland",
    description: locale === "fr" ? "Des agents immobiliers vérifiés à travers le Cameroun." : "Verified real estate agents across Cameroon.",
  };
}

export default async function AgentsDirectoryPage() {
  const t = await getTranslations("AgentsDirectoryPage");
  const data = await listAgents().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-8">{t("subtitle")}</p>

      {data.results.length === 0 ? (
        <p className="text-gray-500">{t("noAgentsYet")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((agent) => (
            <Link key={agent.user_id} href={`/agents/${agent.user_id}`} className="border rounded-lg p-4 bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-lg font-bold text-[#1B2A4A]">
                  {agent.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-[#1B2A4A]">{agent.full_name}</p>
                  {agent.agency_name && <p className="text-xs text-gray-500">{agent.agency_name}</p>}
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">
                  {agent.active_listing_count === 1 ? t("listingsCount", { count: agent.active_listing_count }) : t("listingsCountOther", { count: agent.active_listing_count })}
                </span>
                {agent.is_kyc_verified && (
                  <span className="text-xs font-semibold uppercase text-green-800 bg-green-100 px-2 py-1 rounded">{t("verifiedBadge")}</span>
                )}
              </div>
              {agent.average_rating && (
                <p className="text-[#C9A227] font-semibold text-sm mt-2">★ {agent.average_rating} ({agent.rating_count})</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

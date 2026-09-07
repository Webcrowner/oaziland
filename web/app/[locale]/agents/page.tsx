import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listAgents } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Nos Agents Immobiliers | Oaziland" : "Our Real Estate Agents | Oaziland",
    description: locale === "fr" ? "Des agents immobiliers vérifiés à travers le Cameroun." : "Verified real estate agents across Cameroon.",
  };
}

/**
 * Agents directory — brought onto the shared UI foundation
 * (PageHeader, EmptyState, Badge), continuing the page-by-page pass.
 */
export default async function AgentsDirectoryPage() {
  const t = await getTranslations("AgentsDirectoryPage");
  const data = await listAgents().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="🧑‍💼" title={t("noAgentsYet")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((agent) => (
            <Link
              key={agent.user_id} href={`/agents/${agent.user_id}`}
              className="border rounded-lg p-4 bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-1"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-lg font-bold text-[var(--navy)]">
                  {agent.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-[var(--navy)]">{agent.full_name}</p>
                  {agent.agency_name && <p className="text-xs text-gray-500">{agent.agency_name}</p>}
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">
                  {agent.active_listing_count === 1 ? t("listingsCount", { count: agent.active_listing_count }) : t("listingsCountOther", { count: agent.active_listing_count })}
                </span>
                {agent.is_kyc_verified && <Badge variant="green">{t("verifiedBadge")}</Badge>}
              </div>
              {agent.average_rating && (
                <p className="text-[var(--gold)] font-semibold text-sm mt-2">★ {agent.average_rating} ({agent.rating_count})</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

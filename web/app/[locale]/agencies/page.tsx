import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listAgencies } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Nos Agences Immobilières | Oaziland" : "Our Real Estate Agencies | Oaziland",
    description: locale === "fr" ? "Des agences immobilières enregistrées à travers le Cameroun." : "Registered real estate agencies across Cameroon.",
  };
}

/**
 * Agencies directory — brought onto the shared UI foundation, and a
 * real gap closed at the same time: /api/agencies/{id}/profile/
 * already existed, fully built, but this page never linked to it —
 * every card here was a dead end. Now links to the new
 * /agencies/[id] profile page, mirroring the agent directory exactly.
 */
export default async function AgenciesDirectoryPage() {
  const t = await getTranslations("AgenciesDirectoryPage");
  const data = await listAgencies().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="🏢" title={t("noAgenciesYet")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((agency) => (
            <Link
              key={agency.agency_id} href={`/agencies/${agency.agency_id}`}
              className="border rounded-lg p-4 bg-white transition-all duration-200 hover:shadow-lg hover:-translate-y-1"
            >
              <p className="font-semibold text-[var(--navy)] mb-1">{agency.agency_name}</p>
              <p className="text-xs text-gray-500 mb-3">{agency.registration_number}</p>
              <p className="text-sm text-gray-600">
                {agency.agent_count === 1 ? t("agentsCount", { count: agency.agent_count }) : t("agentsCountOther", { count: agency.agent_count })}
              </p>
              {agency.average_rating && (
                <p className="text-[var(--gold)] font-semibold text-sm mt-2">★ {agency.average_rating} ({agency.rating_count})</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getAgencyPublicProfile } from "@/lib/api";
import type { Metadata } from "next";

/**
 * The real gap this closes: /api/agencies/{id}/profile/ already
 * existed, fully built and aggregating real data across an agency's
 * whole roster of agents, but no page ever showed it — the Agencies
 * directory linked nowhere at all. Same real, dynamic per-entity
 * metadata pattern already established for the agent profile page.
 *
 * WHY there's no RateAndReport here, unlike the agent profile page:
 * an agency's rating is a genuine AGGREGATE across every agent on its
 * roster (get_agency_public_profile's own real design), not a single
 * ratable entity — there's no one "agency user" to direct a rating
 * at. Rating individual agents is how that number actually moves.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string; locale: string }> }): Promise<Metadata> {
  const { id, locale } = await params;
  const profile = await getAgencyPublicProfile(id).catch(() => null);
  if (!profile) return {};

  const title = locale === "fr" ? `${profile.agency_name} — Agence Immobilière | Oaziland` : `${profile.agency_name} — Real Estate Agency | Oaziland`;
  const description = locale === "fr"
    ? `${profile.agency_name} sur Oaziland — ${profile.agent_count} agent(s), ${profile.active_listing_count} annonce(s) active(s).`
    : `${profile.agency_name} on Oaziland — ${profile.agent_count} agent(s), ${profile.active_listing_count} active listing(s).`;

  return { title, description, openGraph: { title, description }, twitter: { card: "summary", title, description } };
}

export default async function AgencyProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("AgencyProfilePage");
  const profile = await getAgencyPublicProfile(id).catch(() => null);
  if (!profile) notFound();

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="border rounded-lg p-6 bg-white">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-2xl font-bold text-[var(--navy)]">
            {profile.agency_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--navy)]">{profile.agency_name}</h1>
            <p className="text-sm text-gray-500">{t("registrationLabel")}: {profile.registration_number}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6">
          {profile.average_rating ? (
            <>
              <span className="text-[var(--gold)] font-bold text-lg">★ {profile.average_rating}</span>
              <span className="text-sm text-gray-500">
                {profile.rating_count === 1 ? t("ratingCount", { count: profile.rating_count }) : t("ratingCountOther", { count: profile.rating_count })}
              </span>
            </>
          ) : (
            <span className="text-sm text-gray-500">{t("noRatingsYet")}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="border border-gray-100 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-[var(--navy)]">{profile.agent_count}</p>
            <p className="text-xs text-gray-500">{profile.agent_count === 1 ? t("agentCount") : t("agentCountOther")}</p>
          </div>
          <div className="border border-gray-100 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-[var(--navy)]">{profile.active_listing_count}</p>
            <p className="text-xs text-gray-500">{profile.active_listing_count === 1 ? t("listingCount") : t("listingCountOther")}</p>
          </div>
        </div>

        <Link href="/search" className="inline-block bg-[var(--navy)] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("viewListings")}
        </Link>
      </div>
    </main>
  );
}

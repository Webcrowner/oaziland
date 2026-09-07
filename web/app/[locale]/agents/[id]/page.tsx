import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getAgentPublicProfile } from "@/lib/api";
import RateAndReport from "@/components/RateAndReport";
import type { Metadata } from "next";

/**
 * Dynamic, real per-agent metadata — same reasoning as the listing
 * detail page: a generic site-wide title would make every agent's
 * profile indistinguishable in search results and in a shared
 * WhatsApp link preview, when the whole point of this page is that
 * it's THIS specific person's professional profile.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string; locale: string }> }): Promise<Metadata> {
  const { id, locale } = await params;
  const profile = await getAgentPublicProfile(id).catch(() => null);
  if (!profile) return {};

  const title = locale === "fr"
    ? `${profile.full_name} — Agent Immobilier | Oaziland`
    : `${profile.full_name} — Real Estate Agent | Oaziland`;
  const description = locale === "fr"
    ? `Consultez les annonces vérifiées de ${profile.full_name} sur Oaziland — ${profile.active_listing_count} annonce(s) active(s).`
    : `View ${profile.full_name}'s verified listings on Oaziland — ${profile.active_listing_count} active listing(s).`;

  return { title, description, openGraph: { title, description }, twitter: { card: "summary", title, description } };
}

/**
 * Public agent profile — the founder's own explicit ask: 'my own
 * space should be well and professionally made for me,' since he'll
 * use this platform himself as an agent and agency owner. No login
 * required, same as browsing a listing — real aggregated data
 * (Prompt: agency.services.get_agent_public_profile), not a static bio.
 */
export default async function AgentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("AgentProfilePage");
  const profile = await getAgentPublicProfile(id).catch(() => null);
  if (!profile) notFound();

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="border rounded-lg p-6 bg-white">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-2xl font-bold text-[#1B2A4A]">
            {profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1B2A4A]">{profile.full_name}</h1>
            {profile.agency_name && <p className="text-sm text-gray-500">{t("agencyLabel")}: {profile.agency_name}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <span className={`text-xs font-semibold uppercase px-3 py-1 rounded ${profile.is_kyc_verified ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
            {profile.is_kyc_verified ? t("verifiedBadge") : t("notYetVerified")}
          </span>
        </div>

        <div className="flex items-center gap-2 mb-6">
          {profile.average_rating ? (
            <>
              <span className="text-[#C9A227] font-bold text-lg">★ {profile.average_rating}</span>
              <span className="text-sm text-gray-500">
                {profile.rating_count === 1 ? t("ratingCount", { count: profile.rating_count }) : t("ratingCountOther", { count: profile.rating_count })}
              </span>
            </>
          ) : (
            <span className="text-sm text-gray-500">{t("noRatingsYet")}</span>
          )}
        </div>

        <p className="text-gray-700 mb-6">
          {profile.active_listing_count === 1
            ? t("activeListings", { count: profile.active_listing_count })
            : t("activeListingsOther", { count: profile.active_listing_count })}
        </p>

        <div className="mb-6 pb-6 border-b border-gray-100">
          <RateAndReport subjectUserId={id} />
        </div>

        <Link href="/search" className="inline-block bg-[#1B2A4A] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("viewListings")}
        </Link>
      </div>
    </main>
  );
}

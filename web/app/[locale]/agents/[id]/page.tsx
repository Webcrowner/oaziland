import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getAgentPublicProfile } from "@/lib/api";
import RateAndReport from "@/components/RateAndReport";
import FollowButton from "@/components/FollowButton";
import AgentShareButton from "@/components/AgentShareButton";
import DirectChatButton from "@/components/DirectChatButton";
import { IconStar, IconShieldCheck, IconAlertCircle, IconBuilding, IconArrowUpRight } from "@/components/Icons";
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
export default async function AgentProfilePage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id, locale } = await params;
  const t = await getTranslations("AgentProfilePage");
  const profile = await getAgentPublicProfile(id).catch(() => null);
  if (!profile) notFound();

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl bg-slate-800 text-4xl font-black text-amber-400 ring-4 ring-white/10 shadow-lg">
            {profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{profile.full_name}</h1>
            {profile.agency_name && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
                <IconBuilding size={14} /> {t("agencyLabel")}: {profile.agency_name}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
                  profile.is_kyc_verified
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                    : "bg-white/10 text-slate-300 border-white/15"
                }`}
              >
                {profile.is_kyc_verified ? <IconShieldCheck size={13} /> : <IconAlertCircle size={13} />}
                {profile.is_kyc_verified ? t("verifiedBadge") : t("notYetVerified")}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <FollowButton userId={id} />
              <AgentShareButton userId={id} name={profile.full_name} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("ratingLabel")}</p>
          {profile.average_rating ? (
            <>
              <p className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-900">
                <IconStar size={22} className="text-amber-400" /> {profile.average_rating}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {profile.rating_count === 1 ? t("ratingCount", { count: profile.rating_count }) : t("ratingCountOther", { count: profile.rating_count })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">{t("noRatingsYet")}</p>
          )}
        </div>
        <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("listingsLabel")}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{profile.active_listing_count}</p>
          <p className="mt-1 text-xs text-slate-400">
            {profile.active_listing_count === 1
              ? t("activeListings", { count: profile.active_listing_count })
              : t("activeListingsOther", { count: profile.active_listing_count })}
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm mb-6">
        <RateAndReport subjectUserId={id} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DirectChatButton
          recipientId={id}
          recipientName={profile.full_name}
          label={locale === "fr" ? `Discuter avec ${profile.full_name}` : `Message ${profile.full_name}`}
        />
        <Link
          href={`/user/${id}`}
          className="inline-flex items-center gap-1.5 bg-amber-400 text-slate-950 font-bold px-5 py-2.5 rounded-xl hover:bg-amber-300 transition-colors shadow-xs text-sm"
        >
          <span>{t("viewFullPortfolio")}</span>
          <IconArrowUpRight size={15} />
        </Link>
        <Link
          href="/search"
          className="inline-block bg-slate-900 text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-slate-800 transition-colors text-sm"
        >
          {t("viewListings")}
        </Link>
      </div>
    </main>
  );
}

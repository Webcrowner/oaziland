import { getTranslations } from "next-intl/server";
import { getListing } from "@/lib/api";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import ContactListingButton from "@/components/ContactListingButton";

const LISTER_ROLE_LABEL_KEYS: Record<string, string> = {
  OWNER: "listerOwnerFull",
  AGENT: "listerAgentFull",
  AGENCY: "listerAgencyFull",
};

/**
 * Listing detail — Page 3 of Prompt 17. Server-rendered with
 * schema.org structured data embedded, per the Technology Stack
 * document's explicit SEO requirement ("structured data markup...
 * so Google can render rich results").
 *
 * WHY the lister section is prominent here, not an afterthought: per
 * the founder's explicit requirement, a viewer deciding whether to
 * reach out needs to know — clearly — whether they'd be dealing with
 * the property owner directly or an agent/agency, since real people
 * have a genuine preference either way.
 */
export default async function ListingDetailPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id } = await params;
  const t = await getTranslations("ListingDetailPage");
  const locale = (await params).locale;
  const listing = await getListing(id).catch(() => null);
  if (!listing) notFound();

  const finishLabels: Record<string, string> = { MODERN: t("finishModern"), STANDARD: t("finishStandard") };
  const price = Number(listing.price_xaf).toLocaleString();
  const finish = finishLabels[listing.property_asset.finish_level] || null;
  const postedDate = listing.published_at
    ? new Date(listing.published_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: `${listing.property_asset.type} in ${listing.property_asset.quarter_name}`,
    price: listing.price_xaf,
    priceCurrency: "XAF",
    address: listing.property_asset.quarter_name,
  };

  return (
    <main>
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="h-64 md:h-96 bg-gray-200 rounded-lg flex items-center justify-center text-gray-600 mb-6">
          {t("noPhotoYet")}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-sm font-semibold uppercase text-white bg-[#1B2A4A] px-3 py-1 rounded">
            {listing.property_asset.type}
          </span>
          {finish && (
            <span className="text-sm font-semibold uppercase text-[#1B2A4A] bg-[#C9A227]/20 px-3 py-1 rounded">
              {finish}
            </span>
          )}
        </div>

        <h1 className="text-3xl font-bold text-[#1B2A4A] mb-2">{price} XAF</h1>
        <p className="text-gray-600 mb-1">📍 {listing.property_asset.quarter_name}</p>
        {postedDate && <p className="text-sm text-gray-400 mb-4">{t("postedOnFull", { date: postedDate })}</p>}

        {listing.property_asset.description && (
          <p className="text-gray-700 mb-6 border-l-4 border-[#C9A227] pl-4">{listing.property_asset.description}</p>
        )}

        {/* Who posted this — the founder's explicit requirement made
            visually clear, not buried in fine print. */}
        <div className={`rounded-lg p-4 mb-6 flex items-center justify-between ${listing.lister_role === "OWNER" ? "bg-green-50" : "bg-[#C9A227]/10"}`}>
          <div>
            <span className={`text-xs font-semibold uppercase px-2 py-1 rounded ${listing.lister_role === "OWNER" ? "bg-green-100 text-green-800" : "bg-[#C9A227]/30 text-[#8A6D14]"}`}>
              {t(LISTER_ROLE_LABEL_KEYS[listing.lister_role] || "listerOwnerFull")}
            </span>
            <p className="font-semibold text-[#1B2A4A] mt-1">
              {listing.lister_role === "AGENT" || listing.lister_role === "AGENCY" ? (
                <Link href={`/agents/${listing.lister_id}`} className="hover:text-[#C9A227]">{listing.lister_display_name}</Link>
              ) : (
                listing.lister_display_name
              )}
            </p>
            {listing.lister_agency_name && <p className="text-sm text-gray-500">{listing.lister_agency_name}</p>}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm border-t pt-4">
          {listing.property_asset.size_sqm && (
            <>
              <dt className="text-gray-500">{t("size")}</dt>
              <dd>{listing.property_asset.size_sqm} m²</dd>
            </>
          )}
          <dt className="text-gray-500">{t("listingType")}</dt>
          <dd>{listing.listing_type}</dd>
        </dl>

        <ContactListingButton listingId={listing.id} />
      </div>
    </main>
  );
}

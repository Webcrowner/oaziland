import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import PhotoGallery from "@/components/PhotoGallery";
import ListerRoleBadge from "@/components/ListerRoleBadge";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";
import DirectChatButton from "@/components/DirectChatButton";
import PropertyMap from "@/components/PropertyMap";
import Badge from "@/components/ui/Badge";
import OwnerMediaManager from "@/components/OwnerMediaManager";
import RateAndReport from "@/components/RateAndReport";
import type { AssetMediaEndpoint, PropertyAssetPhotoItem } from "@/lib/api";

export interface DetailRow {
  primary: string;
  secondary?: string;
  right?: string;
}

export interface AssetDetailProps {
  backHref: string;
  backLabel: string;
  title: string;
  location: string;
  photos: PropertyAssetPhotoItem[];
  listerRole?: string;
  ownerId?: string;
  ownerName?: string | null;
  verified?: boolean;
  isSale?: boolean;
  priceText?: string;
  description?: string;
  amenities?: string[];
  facts?: { label: string; value: string }[];
  sectionTitle?: string;
  rows?: DetailRow[];
  latitude?: string | number | null;
  longitude?: string | number | null;
  sharePath: string;
  shareTitle: string;
  sharePrice?: string;
  mediaEndpoint?: AssetMediaEndpoint;
  assetId?: string;
}

const humanize = (value: string) => value.replace(/_/g, " ").toLowerCase();

/** Shared full-detail page for hotels, venues, guest houses and student hostels. */
export default async function AssetDetailView(props: AssetDetailProps) {
  const t = await getTranslations("AssetDetail");
  const { photos, facts = [], rows = [], amenities = [] } = props;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <Link href={props.backHref} className="text-sm font-semibold text-[var(--navy)] hover:text-[var(--gold)] mb-4 inline-block">
        ← {props.backLabel}
      </Link>

      <PhotoGallery photos={photos} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <ListerRoleBadge role={props.listerRole} isSale={props.isSale} />
            {props.verified !== undefined && (
              <Badge variant={props.verified ? "green" : "gold"}>{props.verified ? t("verified") : t("pendingReview")}</Badge>
            )}
          </div>

          <h1 className="text-3xl font-bold text-[var(--navy)] mb-1">{props.title}</h1>
          {props.priceText && <p className="text-2xl font-bold text-[var(--navy)] mb-1">{props.priceText}</p>}
          <p className="text-gray-600 mb-4">📍 {props.location}</p>

          {facts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base text-gray-700 border-y border-gray-200 py-4 mb-6">
              {facts.map((f) => (
                <span key={f.label}><strong>{f.value}</strong> {f.label}</span>
              ))}
            </div>
          )}

          {props.description && (
            <p className="text-gray-700 mb-6 border-l-4 border-[var(--gold)] pl-4 whitespace-pre-line">{props.description}</p>
          )}

          {amenities.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">{t("amenities")}</h2>
              <div className="flex flex-wrap gap-2">
                {amenities.map((a) => <Badge key={a} variant="green"><span className="capitalize">{humanize(a)}</span></Badge>)}
              </div>
            </div>
          )}

          {rows.length > 0 && props.sectionTitle && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">{props.sectionTitle}</h2>
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-start justify-between gap-4 p-3 text-sm">
                    <div>
                      <p className="font-semibold text-[var(--navy)] capitalize">{row.primary}</p>
                      {row.secondary && <p className="text-gray-500 text-xs mt-0.5">{row.secondary}</p>}
                    </div>
                    {row.right && <p className="font-bold text-gray-900 whitespace-nowrap">{row.right}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {props.latitude && props.longitude && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">{t("location")}</h2>
              <PropertyMap latitude={Number(props.latitude)} longitude={Number(props.longitude)} label={props.title} />
            </div>
          )}

          {props.mediaEndpoint && props.assetId && (
            <OwnerMediaManager
              endpoint={props.mediaEndpoint}
              assetId={props.assetId}
              ownerId={props.ownerId}
              media={photos}
              folder={props.mediaEndpoint}
            />
          )}
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start flex flex-col gap-3">
          {props.ownerId && (
            <div className="rounded-lg p-4 bg-gray-50 border border-gray-200">
              <ListerRoleBadge role={props.listerRole} isSale={props.isSale} />
              <p className="font-semibold text-[var(--navy)] mt-1">
                <Link href={`/user/${props.ownerId}`} className="hover:text-[var(--gold)]">
                  {props.ownerName || t("viewLister")}
                </Link>
              </p>
              <div className="mt-3 pt-3 border-t border-black/10">
                <RateAndReport subjectUserId={props.ownerId} />
              </div>
            </div>
          )}
          {props.ownerId && (
            <DirectChatButton
              recipientId={props.ownerId}
              recipientName={props.ownerName || undefined}
              label={t("messageLister")}
              className="w-full inline-flex items-center justify-center gap-1.5 bg-slate-900 text-amber-300 font-semibold px-4 py-2.5 rounded-lg text-sm hover:bg-slate-800 transition-colors"
            />
          )}
          <WhatsAppShareButton
            variant="detail"
            title={props.shareTitle}
            location={props.location}
            price={props.sharePrice}
            path={props.sharePath}
          />
        </div>
      </div>
    </main>
  );
}

import { addMarketplaceMedia, type MarketplaceCategory, type MediaUploadResult } from "@/lib/api";
import { saveConditions, type ConditionsDraft } from "@/components/MarketplaceConditionsFields";

/**
 * Attaches the photos and conditions to a listing that was just created and returns where to send the lister.
 * The listing already exists, so a file or conditions failure must not make them post it twice: it is reported
 * on the listing page (?mediaFailed / ?conditionsFailed) where they can add the missing pieces again.
 */
export async function finishMarketplacePost(
  category: MarketplaceCategory, listingId: string, media: MediaUploadResult[], conditions: ConditionsDraft, accessToken: string,
): Promise<string> {
  let mediaFailed = 0;
  for (const m of media) {
    await addMarketplaceMedia(category, listingId, m.url, m.media_type, accessToken).catch(() => { mediaFailed += 1; });
  }
  const conditionsFailed = await saveConditions(category, listingId, conditions, accessToken, true).then(() => false, () => true);

  const params = new URLSearchParams();
  if (mediaFailed) params.set("mediaFailed", String(mediaFailed));
  if (conditionsFailed) params.set("conditionsFailed", "1");
  const query = params.toString();
  return `/marketplace/${category}/${listingId}${query ? `?${query}` : ""}`;
}

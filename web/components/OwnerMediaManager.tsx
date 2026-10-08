"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import MediaUploader from "@/components/MediaUploader";
import MediaThumbs from "@/components/MediaThumbs";
import {
  addAssetMedia, removeAssetMedia, getMyProfile,
  type AssetMediaEndpoint, type MediaUploadResult,
} from "@/lib/api";

interface ExistingMedia {
  id: number;
  url: string;
  media_type: "PHOTO" | "VIDEO";
}

/** Lets the owner/lister add or remove photos and videos from a detail page; renders nothing for anyone else. */
export default function OwnerMediaManager({
  endpoint, assetId, ownerId, media, folder,
}: {
  endpoint: AssetMediaEndpoint;
  assetId: string;
  ownerId?: string;
  media: ExistingMedia[];
  folder: string;
}) {
  const t = useTranslations("OwnerMedia");
  const router = useRouter();
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Attaching in sequence keeps the first upload flagged as the primary photo.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !ownerId) return;
    getMyProfile(token).then((p) => setIsOwner(p.id === ownerId)).catch(() => {});
  }, [ownerId]);

  if (!isOwner) return null;

  function handleUploaded(result: MediaUploadResult) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    queue.current = queue.current.then(() =>
      addAssetMedia(endpoint, assetId, result.url, result.media_type, token)
        .then(() => router.refresh())
        .catch((e: Error) => setError(e.message))
    );
  }

  async function handleRemove(index: number) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await removeAssetMedia(endpoint, assetId, media[index].id, token);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-[var(--gold)] p-4 bg-[var(--gold)]/5">
      <h2 className="text-sm font-semibold text-[var(--navy)] mb-1">{t("title")}</h2>
      <p className="text-xs text-gray-500 mb-3">{t("hint")}</p>
      <MediaUploader folder={folder} onUploaded={handleUploaded} label={t("add")} />
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
      <MediaThumbs items={media} onRemove={handleRemove} removeLabel={t("remove")} />
    </div>
  );
}

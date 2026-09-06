"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ListingPhotoItem } from "@/lib/api";

/**
 * A real photo gallery for the listing detail page — a large primary
 * image with a real thumbnail strip beneath it, click-to-switch. The
 * exact pattern every major listing detail page uses: the photo IS
 * the page's first, dominant element, not a small inline placeholder
 * competing with text for attention.
 */
export default function PhotoGallery({ photos }: { photos: ListingPhotoItem[] }) {
  const t = useTranslations("ListingDetailPage");
  const [activeIndex, setActiveIndex] = useState(0);
  const realPhotos = photos.filter((p) => p.media_type === "PHOTO");

  if (realPhotos.length === 0) {
    return (
      <div className="h-64 md:h-[28rem] bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 mb-6">
        {t("noPhotoYet")}
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="h-72 md:h-[28rem] rounded-lg overflow-hidden bg-gray-100">
        <img src={realPhotos[activeIndex].url} alt="" className="w-full h-full object-cover" />
      </div>
      {realPhotos.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {realPhotos.map((photo, i) => (
            <button
              key={photo.id} onClick={() => setActiveIndex(i)}
              className={`shrink-0 w-20 h-16 rounded-md overflow-hidden border-2 transition-colors ${i === activeIndex ? "border-[var(--gold)]" : "border-transparent opacity-70 hover:opacity-100"}`}
            >
              <img src={photo.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

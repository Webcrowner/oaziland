"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ListingPhotoItem } from "@/lib/api";

/**
 * Listing media gallery — a large primary viewer (photo or playable
 * video) with prev/next arrows, a counter, keyboard + swipe support and
 * a click-to-switch thumbnail strip beneath it.
 */
export default function PhotoGallery({ photos }: { photos: ListingPhotoItem[] }) {
  const t = useTranslations("ListingDetailPage");
  const [activeIndex, setActiveIndex] = useState(0);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const touchStartX = useRef<number | null>(null);

  const total = photos.length;
  const goTo = (index: number) => setActiveIndex(((index % total) + total) % total);

  useEffect(() => {
    thumbRefs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeIndex]);

  if (photos.length === 0) {
    return (
      <div className="h-64 md:h-[28rem] bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 mb-6">
        {t("noPhotoYet")}
      </div>
    );
  }

  const active = photos[activeIndex];
  const arrowClass =
    "absolute top-1/2 -translate-y-1/2 z-10 w-12 h-12 md:w-16 md:h-16 rounded-full bg-white text-slate-900 border-2 border-slate-900/10 shadow-xl shadow-black/40 flex items-center justify-center transition-transform hover:scale-110 hover:bg-[var(--gold)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--gold)]";
  const chevron = (d: string) => (
    <svg className="w-6 h-6 md:w-8 md:h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );

  return (
    <div
      className="mb-6 focus:outline-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") goTo(activeIndex + 1);
        if (e.key === "ArrowLeft") goTo(activeIndex - 1);
      }}
    >
      <div
        className="relative h-72 md:h-[28rem] rounded-lg overflow-hidden bg-black"
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (touchStartX.current === null || total < 2) return;
          const delta = e.changedTouches[0].clientX - touchStartX.current;
          touchStartX.current = null;
          if (Math.abs(delta) > 50) goTo(activeIndex + (delta < 0 ? 1 : -1));
        }}
      >
        {active.media_type === "VIDEO" ? (
          <video key={active.id} src={active.url} controls playsInline className="w-full h-full object-contain" />
        ) : (
          <img src={active.url} alt="" className="w-full h-full object-cover" />
        )}

        {total > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => goTo(activeIndex - 1)} className={`${arrowClass} left-3 md:left-5`}>
              {chevron("M15 18l-6-6 6-6")}
            </button>
            <button type="button" aria-label="Next photo" onClick={() => goTo(activeIndex + 1)} className={`${arrowClass} right-3 md:right-5`}>
              {chevron("M9 18l6-6-6-6")}
            </button>
            <span className="absolute bottom-3 right-3 md:bottom-4 md:right-5 px-3 py-1.5 rounded-full bg-white text-slate-900 text-sm font-bold shadow-lg pointer-events-none">
              {activeIndex + 1} / {total}
            </span>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {photos.map((item, i) => (
            <button
              key={item.id}
              type="button"
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              onClick={() => setActiveIndex(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === activeIndex}
              className={`relative shrink-0 w-24 h-20 rounded-md overflow-hidden border-2 transition-colors ${i === activeIndex ? "border-[var(--gold)]" : "border-transparent opacity-70 hover:opacity-100"}`}
            >
              {item.media_type === "VIDEO" ? (
                <div className="w-full h-full bg-slate-800 text-white flex items-center justify-center text-lg">▶</div>
              ) : (
                <img src={item.url} alt="" className="w-full h-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

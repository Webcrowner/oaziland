"use client";

interface ThumbItem {
  url: string;
  media_type: "PHOTO" | "VIDEO";
}

/** Small preview grid of photos/videos with an optional remove button per item. */
export default function MediaThumbs({
  items,
  onRemove,
  removeLabel = "Remove",
}: {
  items: ThumbItem[];
  onRemove?: (index: number) => void;
  removeLabel?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-2">
      {items.map((item, i) => (
        <div key={`${item.url}-${i}`} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
          {item.media_type === "VIDEO" ? (
            <video src={item.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
          ) : (
            <img src={item.url} alt="" className="w-full h-full object-cover" />
          )}
          {item.media_type === "VIDEO" && (
            <span className="absolute bottom-1 left-1 text-[10px] font-bold bg-black/70 text-white px-1.5 rounded">▶</span>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={removeLabel}
              title={removeLabel}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs hover:bg-rose-600 transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

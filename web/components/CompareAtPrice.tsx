import { compareAtDisplay } from "@/lib/comparePrice";

/** A struck-through "was" price with a "-NN%" badge; renders nothing unless the compare-at price is higher than the price shown. */
export default function CompareAtPrice({
  compareAtXaf, shownPrice, originalPrice, compact = false, showUnit = true,
}: {
  compareAtXaf: string | number | null | undefined;
  shownPrice: number;
  originalPrice?: number;
  compact?: boolean;
  showUnit?: boolean;
}) {
  const display = compareAtDisplay(compareAtXaf, shownPrice, originalPrice);
  if (!display) return null;
  return (
    <>
      <s className={compact ? "text-xs font-medium text-slate-400" : "text-base font-semibold text-slate-400"}>
        {display.was.toLocaleString()}{showUnit ? " XAF" : ""}
      </s>
      {display.percent > 0 && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-800">-{display.percent}%</span>
      )}
    </>
  );
}

/** Read-only 0-5 star display (rounded to the nearest half star). */
export default function StarRating({ value, size = "text-sm", label }: { value: number; size?: string; label?: string }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className={`inline-flex items-center ${size} leading-none`} role="img" aria-label={label ?? `${value} / 5`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = rounded >= star ? 100 : rounded >= star - 0.5 ? 50 : 0;
        return (
          <span key={star} className="relative inline-block text-slate-300" aria-hidden>
            ★
            <span className="absolute inset-0 overflow-hidden text-amber-500" style={{ width: `${fill}%` }}>★</span>
          </span>
        );
      })}
    </span>
  );
}

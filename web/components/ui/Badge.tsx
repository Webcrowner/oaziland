/**
 * A consistent badge — consolidates the property-type, finish-level,
 * lister-role, and status badges already scattered across the app
 * (each currently hand-styled per page) into one shared component
 * with real, named variants.
 */
const VARIANTS = {
  navy: "bg-[var(--navy)] text-white",
  gold: "bg-[#FBF3DC] text-[#8A6D14]",
  green: "bg-green-50 text-green-800",
  neutral: "bg-gray-100 text-gray-700",
  clay: "bg-[var(--clay)]/10 text-[var(--clay)]",
} as const;

export default function Badge({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
}) {
  return (
    <span className={`inline-block text-xs font-semibold uppercase px-2 py-1 rounded ${VARIANTS[variant]}`}>
      {children}
    </span>
  );
}

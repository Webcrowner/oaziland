import type { ReactNode } from "react";

/**
 * A real empty state — replaces the plain grey text ("No hotels yet.")
 * that every browse page currently falls back to. An empty result set
 * is not an error and not a dead end; it should read as calm and
 * intentional, with a real next step where one exists (e.g. "browse
 * all listings instead"), not just an apology.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60">
      {icon && (
        <div className="w-16 h-16 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-3xl mb-5">
          {icon}
        </div>
      )}
      <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-slate-900 mb-1.5">{title}</p>
      {description && <p className="text-sm text-slate-500 max-w-sm mb-5 leading-relaxed">{description}</p>}
      {action}
    </div>
  );
}

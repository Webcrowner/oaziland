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
    <div className="flex flex-col items-center text-center py-16 px-4">
      {icon && <div className="text-4xl mb-4 opacity-60">{icon}</div>}
      <p className="font-[family-name:var(--font-display)] text-lg text-[var(--navy)] mb-1">{title}</p>
      {description && <p className="text-sm text-gray-500 max-w-sm mb-5">{description}</p>}
      {action}
    </div>
  );
}

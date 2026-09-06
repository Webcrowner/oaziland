import type { ReactNode } from "react";

/** The consistent title/subtitle/optional-action row used at the
 * top of every browse and account page. */
export default function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl text-[var(--navy)] mb-1">{title}</h1>
        {subtitle && <p className="text-gray-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

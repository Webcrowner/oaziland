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
    <div className="flex items-start justify-between gap-4 flex-wrap mb-8 pb-6 border-b border-slate-200/80">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-bold text-slate-900 mb-1.5 tracking-tight">{title}</h1>
        {subtitle && <p className="text-slate-500 text-sm md:text-base max-w-xl leading-relaxed">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

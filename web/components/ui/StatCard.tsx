import type { ComponentType, ReactNode } from "react";

const TONES = {
  default: { icon: "bg-slate-900 text-amber-300", value: "text-slate-900" },
  emerald: { icon: "bg-emerald-50 text-emerald-600", value: "text-emerald-600" },
  indigo: { icon: "bg-indigo-50 text-indigo-600", value: "text-indigo-600" },
  amber: { icon: "bg-amber-50 text-amber-600", value: "text-amber-600" },
  rose: { icon: "bg-rose-50 text-rose-600", value: "text-rose-600" },
} as const;

/** A single headline metric used across the owner/host/agent dashboards. */
export default function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
  tone?: keyof typeof TONES;
}) {
  const styles = TONES[tone];
  return (
    <div className="flex items-start gap-4 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm">
      {Icon && (
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${styles.icon}`}>
          <Icon size={20} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`mt-1 truncate text-2xl font-black tracking-tight ${styles.value}`}>
          {value}
          {unit && <span className="ml-1 text-sm font-semibold text-slate-400">{unit}</span>}
        </p>
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}

// Shared field/card/button treatment, matching Taskln Service so the
// own-branded service pages read as one product.
export const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15";
export const cardCls = "rounded-3xl border border-slate-300/80 bg-white p-5 sm:p-6 shadow-sm";
export const labelCls = "mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500";
export const pillBtnCls =
  "rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
export const solidBtnCls =
  "rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50";
export const dangerBtnCls =
  "rounded-xl border border-red-200 bg-white px-3.5 py-2 text-xs font-bold text-red-700 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50";

export const RIDE_CATEGORIES = ["MOTO", "STANDARD", "COMFORT", "VAN", "TRUCK"] as const;

export const STATUS_VARIANT: Record<string, "navy" | "gold" | "green" | "clay"> = {
  REQUESTED: "gold", ACCEPTED: "navy", IN_PROGRESS: "navy", COMPLETED: "green", CANCELLED: "clay",
};

export const ACTIVE_RIDE_STATUSES = ["REQUESTED", "ACCEPTED", "IN_PROGRESS"];

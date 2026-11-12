export const TRAINING_CATEGORIES = [
  "PROPERTY_MANAGEMENT_BASICS",
  "TENANT_LAW",
  "AGENCY_LICENSING_PREP",
  "HOSPITALITY_OPERATIONS",
  "OTHER",
] as const;

const THEMES: Record<string, { icon: string; gradient: string }> = {
  PROPERTY_MANAGEMENT_BASICS: { icon: "🏢", gradient: "from-[#1b2a4a] to-[#3b5a8f]" },
  TENANT_LAW: { icon: "⚖️", gradient: "from-[#a8502e] to-[#cf7d55]" },
  AGENCY_LICENSING_PREP: { icon: "📜", gradient: "from-[#8a6d14] to-[#d4af37]" },
  HOSPITALITY_OPERATIONS: { icon: "🛎️", gradient: "from-[#0f766e] to-[#2aa79b]" },
};

/** The icon and Tailwind gradient used for a course without a cover image. */
export const trainingTheme = (category: string) => THEMES[category] ?? { icon: "🎓", gradient: "from-slate-700 to-slate-500" };

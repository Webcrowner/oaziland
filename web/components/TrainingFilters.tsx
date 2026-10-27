"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { TRAINING_CATEGORIES } from "@/lib/trainingCategories";

export interface TrainingFilterValues {
  q: string;
  category: string;
  free: boolean;
  certificate: boolean;
}

/** Filters live in the URL (so results stay server-rendered, shareable
 * and back-button friendly); changing any of them resets to page 1. */
export default function TrainingFilters({ initial }: { initial: TrainingFilterValues }) {
  const t = useTranslations("TrainingPage");
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initial.q);

  function apply(next: Partial<TrainingFilterValues>) {
    const values = { ...initial, q, ...next };
    const params = new URLSearchParams();
    if (values.q.trim()) params.set("q", values.q.trim());
    if (values.category) params.set("category", values.category);
    if (values.free) params.set("free", "true");
    if (values.certificate) params.set("certificate", "true");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const hasFilters = Boolean(initial.q || initial.category || initial.free || initial.certificate);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply({});
      }}
      className="-mt-12 mb-8 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-900/5 relative"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-[var(--navy)] focus:ring-2 focus:ring-[var(--navy)]/15"
        />
        <select
          value={initial.category}
          onChange={(e) => apply({ category: e.target.value })}
          aria-label={t("categoryLabel")}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[var(--navy)] focus:ring-2 focus:ring-[var(--navy)]/15"
        >
          <option value="">{t("allCategories")}</option>
          {TRAINING_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`categories.${category}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-xl bg-[var(--navy)] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#25396a]">
          {t("searchButton")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-5 text-sm text-slate-700">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={initial.free} onChange={(e) => apply({ free: e.target.checked })} className="h-4 w-4 accent-[var(--navy)]" />
          {t("freeOnly")}
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={initial.certificate} onChange={(e) => apply({ certificate: e.target.checked })} className="h-4 w-4 accent-[var(--navy)]" />
          {t("certificateOnly")}
        </label>
        {hasFilters && (
          <button type="button" onClick={() => router.push(pathname)} className="text-[var(--navy)] underline">
            {t("clearFilters")}
          </button>
        )}
      </div>
    </form>
  );
}

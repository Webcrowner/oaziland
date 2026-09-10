"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createSavedSearch } from "@/lib/api";

/**
 * Saves the CURRENT search's real filters — the actual params the
 * page was rendered with, not a re-typed guess at them.
 */
export default function SaveSearchButton({ filters }: { filters: Record<string, string> }) {
  const t = useTranslations("SavedSearchesPage");
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setSaving(true);
    try {
      await createSavedSearch("", filters, token);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return <p className="text-green-700 text-sm">{t("searchSaved")}</p>;
  }

  return (
    <button onClick={handleSave} disabled={saving} className="text-sm font-semibold text-[var(--navy)] hover:text-[var(--gold)] underline disabled:opacity-50">
      {t("saveThisSearch")}
    </button>
  );
}

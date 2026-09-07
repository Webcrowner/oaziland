"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { listSavedSearches, deleteSavedSearch, type SavedSearch } from "@/lib/api";

export default function SavedSearchesPage() {
  const t = useTranslations("SavedSearchesPage");
  const locale = useLocale();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    listSavedSearches(token)
      .then((data) => {
        setSearches(data.results);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await deleteSavedSearch(id, token);
    load();
  }

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Button href="/login">{t("signInRequired")}</Button>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : searches.length === 0 ? (
        <EmptyState icon="🔎" title={t("noSavedSearchesYet")} action={<Button variant="secondary" href="/search">{t("saveThisSearch")}</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          {searches.map((search) => (
            <div key={search.id} className="border rounded-lg p-4 bg-white flex items-center justify-between">
              <div>
                <p className="font-semibold text-[var(--navy)]">{search.name || t("title")}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {search.last_notified_at
                    ? t("lastNotified", { date: new Date(search.last_notified_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US") })
                    : t("neverNotified")}
                </p>
              </div>
              <button onClick={() => handleDelete(search.id)} className="text-red-600 text-sm font-semibold hover:underline">
                {t("delete")}
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

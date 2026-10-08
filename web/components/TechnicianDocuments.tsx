"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { saveTechnicianDocuments, type TechnicianProfileItem, type MediaUploadResult } from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";

/** Credential documents (admin-reviewed before verification) and public portfolio photos. */
export default function TechnicianDocuments({
  profile,
  onSaved,
}: {
  profile: TechnicianProfileItem;
  onSaved: (profile: TechnicianProfileItem) => void;
}) {
  const t = useTranslations("TasklnServicePage");
  const [error, setError] = useState("");

  async function save(credentials: string[], portfolio: string[]) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setError("");
    try {
      onSaved(await saveTechnicianDocuments(credentials, portfolio, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveDocsFailed"));
    }
  }

  const credentials = profile.credential_urls || [];
  const portfolio = profile.portfolio_urls || [];

  function renderList(urls: string[], onRemove: (url: string) => void) {
    return (
      <div className="flex flex-wrap gap-2 mb-2">
        {urls.map((url) => (
          <div key={url} className="relative">
            <a href={url} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
            </a>
            <button
              type="button"
              onClick={() => onRemove(url)}
              aria-label={t("remove")}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] leading-none"
            >
              x
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1">
          {t("credentialsTitle")}{profile.is_verified ? "" : ` - ${t("credentialsRequired")}`}
        </p>
        {renderList(credentials, (url) => save(credentials.filter((u) => u !== url), portfolio))}
        <MediaUploader
          folder="technician-credentials"
          label={t("addCredential")}
          onUploaded={(result: MediaUploadResult) => save([...credentials, result.url], portfolio)}
        />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1">{t("portfolioTitle")}</p>
        {renderList(portfolio, (url) => save(credentials, portfolio.filter((u) => u !== url)))}
        <MediaUploader
          folder="technician-portfolio"
          label={t("addPortfolioPhoto")}
          onUploaded={(result: MediaUploadResult) => save(credentials, [...portfolio, result.url])}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

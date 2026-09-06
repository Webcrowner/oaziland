"use client";
import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { uploadMediaFile, type MediaUploadResult } from "@/lib/api";

/**
 * A real photo/video picker and uploader — closes the gap behind
 * every "No photo yet" placeholder. Accepts BOTH images and video
 * (accept="image/*,video/*"), since a real video walkthrough is a
 * genuinely common thing a lister or poster would want to attach,
 * not just photos. On mobile browsers, an accept attribute including
 * video automatically offers "record a video" alongside "choose from
 * library" — the same native capture behavior already used for
 * photos, no extra code needed here for that.
 */
export default function MediaUploader({
  folder,
  onUploaded,
  label,
}: {
  folder: string;
  onUploaded: (result: MediaUploadResult) => void;
  label: string;
}) {
  const t = useTranslations("MediaUploader");
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [previewName, setPreviewName] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewName(file.name);

    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }

    setStatus("uploading");
    try {
      const result = await uploadMediaFile(file, folder, token);
      onUploaded(result);
      setStatus("idle");
    } catch {
      setStatus("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef} type="file" accept="image/*,video/*" onChange={handleFileChange}
        id="media-uploader-input" className="hidden"
      />
      <label
        htmlFor="media-uploader-input"
        className="inline-flex items-center gap-2 border border-[var(--navy)] text-[var(--navy)] font-semibold px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors text-sm"
      >
        {status === "uploading" ? t("uploading") : label}
      </label>
      {status === "error" && <p className="text-red-600 text-xs mt-1">{t("uploadFailed")}</p>}
      {previewName && status === "idle" && <p className="text-gray-500 text-xs mt-1">{previewName}</p>}
    </div>
  );
}

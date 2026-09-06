"use client";
import { useState, Suspense } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { createPost, type MediaUploadResult } from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";

/**
 * Real post creation — wraps in Suspense for useSearchParams, the
 * same fix already applied to the register page this session.
 * WHY ?listing_id= matters: this is what the real-estate CTA on the
 * listing detail page links into, letting a landlord/agent/owner/
 * agency cross-promote their listing as a social post in one step.
 */
export default function CreatePostPage() {
  return (
    <Suspense fallback={null}>
      <CreatePostForm />
    </Suspense>
  );
}

function CreatePostForm() {
  const t = useTranslations("CreatePostPage");
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedListingId = searchParams.get("listing_id") || undefined;

  const [caption, setCaption] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [status, setStatus] = useState<"idle" | "posting" | "posted" | "blocked" | "signedOut">("idle");

  function handleMediaUploaded(result: MediaUploadResult) {
    setMedia((prev) => [...prev, result]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    setStatus("posting");
    try {
      await createPost({
        caption,
        tags: tagsInput.split(",").map((tag) => tag.trim()).filter(Boolean),
        linked_listing_id: linkedListingId,
        media_urls: media.map((m) => m.url),
      }, token);
      setStatus("posted");
      setTimeout(() => router.push("/feed"), 1200);
    } catch {
      setStatus("blocked");
    }
  }

  if (status === "signedOut") {
    router.push("/login");
    return null;
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-6">{t("title")}</h1>

      {linkedListingId && (
        <p className="text-sm bg-[#C9A227]/10 text-[#8A6D14] rounded px-3 py-2 mb-4">{t("linkedToListing")}</p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          required rows={4} placeholder={t("captionPlaceholder")} value={caption}
          onChange={(e) => setCaption(e.target.value)} className="border rounded px-3 py-2"
        />
        <input
          type="text" placeholder={t("tagsPlaceholder")} value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)} className="border rounded px-3 py-2"
        />

        <MediaUploader folder="posts" onUploaded={handleMediaUploaded} label={t("addPhotoOrVideo")} />
        {media.length > 0 && <p className="text-xs text-gray-500">{t("mediaAttached", { count: media.length })}</p>}

        {status === "blocked" && <p className="text-red-600 text-sm">{t("blocked")}</p>}
        {status === "posted" && <p className="text-green-700 text-sm">{t("posted")}</p>}

        <button type="submit" disabled={status === "posting"} className="bg-[#C9A227] text-[#1B2A4A] font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
          {status === "posting" ? t("posting") : t("post")}
        </button>
      </form>
    </main>
  );
}

"use client";
import { useState, useEffect, Suspense } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { createPost, CreatePostError, type MediaUploadResult } from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";

const MAX_CAPTION_LENGTH = 2200;
const MAX_TAGS = 20;
const MAX_MEDIA = 10;

type Status = "idle" | "posting" | "posted" | "blocked" | "invalid" | "failed";

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
  const [status, setStatus] = useState<Status>("idle");
  const [serverMessage, setServerMessage] = useState("");

  // The author's own posts are not in the main feed, so land on "My posts" to show the new post.
  useEffect(() => {
    if (status !== "posted") return;
    const timer = setTimeout(() => router.push("/feed?tab=mine"), 1200);
    return () => clearTimeout(timer);
  }, [status, router]);

  function handleMediaUploaded(result: MediaUploadResult) {
    setMedia((prev) => (prev.length >= MAX_MEDIA ? prev : [...prev, result]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "posting" || status === "posted") return;
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    const tags = [...new Set(tagsInput.split(",").map((tag) => tag.trim().replace(/^#+/, "").trim()).filter(Boolean))].slice(0, MAX_TAGS);
    setStatus("posting");
    setServerMessage("");
    try {
      await createPost({
        caption: caption.trim(),
        tags,
        linked_listing_id: linkedListingId,
        media_urls: media.map((m) => m.url),
      }, token);
      setStatus("posted");
    } catch (err) {
      if (err instanceof CreatePostError && err.kind === "moderation") {
        setStatus("blocked");
      } else if (err instanceof CreatePostError && err.kind === "validation") {
        setServerMessage(err.message);
        setStatus("invalid");
      } else {
        setStatus("failed");
      }
    }
  }

  const busy = status === "posting" || status === "posted";

  return (
    <main className="max-w-lg mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-[var(--navy)] mb-6">{t("title")}</h1>

      {linkedListingId && (
        <p className="text-sm bg-[var(--gold)]/10 text-[#8A6D14] rounded px-3 py-2 mb-4">{t("linkedToListing")}</p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <textarea
            required={media.length === 0} rows={4} maxLength={MAX_CAPTION_LENGTH} placeholder={t("captionPlaceholder")}
            aria-label={t("captionPlaceholder")} value={caption} onChange={(e) => setCaption(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
          <p className="text-xs text-gray-400 text-right">{caption.length}/{MAX_CAPTION_LENGTH}</p>
        </div>
        <input
          type="text" placeholder={t("tagsPlaceholder")} aria-label={t("tagsPlaceholder")} value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)} className="border rounded px-3 py-2"
        />

        {media.length < MAX_MEDIA && <MediaUploader folder="posts" onUploaded={handleMediaUploaded} label={t("addPhotoOrVideo")} />}
        {media.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {media.map((item, index) => (
              <li key={item.url} className="relative h-20 w-20 overflow-hidden rounded border bg-gray-100 text-xs text-gray-500 flex items-center justify-center">
                {item.media_type === "VIDEO" ? (
                  <span>🎬</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                )}
                <button
                  type="button" onClick={() => setMedia((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={t("removeMedia")} className="absolute right-0 top-0 bg-black/60 px-1.5 text-white"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {status === "blocked" && <p role="alert" className="text-red-600 text-sm">{t("blocked")}</p>}
        {status === "invalid" && <p role="alert" className="text-red-600 text-sm">{serverMessage || t("failed")}</p>}
        {status === "failed" && <p role="alert" className="text-red-600 text-sm">{t("failed")}</p>}
        {status === "posted" && <p role="status" className="text-green-700 text-sm">{t("posted")}</p>}

        <button type="submit" disabled={busy} className="bg-[var(--gold)] text-[var(--navy)] font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
          {status === "posting" ? t("posting") : t("post")}
        </button>
      </form>
    </main>
  );
}

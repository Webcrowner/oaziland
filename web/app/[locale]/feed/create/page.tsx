"use client";
import { useState, useEffect, Suspense } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { createPost, CreatePostError, type MediaUploadResult } from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";
import Button from "@/components/ui/Button";

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
  // null until checked, so signed-out visitors never start a post they can't send.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    void Promise.resolve().then(() => setLoggedIn(Boolean(token)));
  }, []);

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

  if (loggedIn === null) return null;
  if (!loggedIn) {
    return (
      <main className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-black tracking-tight text-slate-900 mb-3">{t("title")}</h1>
        <p className="mb-6 text-slate-600">{t("signInRequired")}</p>
        <Button href="/login">{t("signIn")}</Button>
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-black tracking-tight text-slate-900 mb-6">{t("title")}</h1>

      {linkedListingId && (
        <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{t("linkedToListing")}</p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <textarea
            required={media.length === 0} rows={5} maxLength={MAX_CAPTION_LENGTH} placeholder={t("captionPlaceholder")}
            aria-label={t("captionPlaceholder")} value={caption} onChange={(e) => setCaption(e.target.value)}
            className="w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-[15px] outline-none placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-400/15"
          />
          <p className="mt-1 text-right text-xs font-semibold text-slate-400">{caption.length}/{MAX_CAPTION_LENGTH}</p>
        </div>
        <input
          type="text" placeholder={t("tagsPlaceholder")} aria-label={t("tagsPlaceholder")} value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-400/15"
        />

        {media.length < MAX_MEDIA && <MediaUploader folder="posts" onUploaded={handleMediaUploaded} label={t("addPhotoOrVideo")} />}
        {media.length > 0 && (
          <ul className="flex flex-wrap gap-3">
            {media.map((item, index) => (
              <li key={item.url} className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 text-xs text-slate-500">
                {item.media_type === "VIDEO" ? (
                  <span>🎬</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" className="h-full w-full object-cover" />
                )}
                <button
                  type="button" onClick={() => setMedia((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={t("removeMedia")} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/70 text-white hover:bg-slate-900"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {status === "blocked" && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t("blocked")}</p>}
        {status === "invalid" && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{serverMessage || t("failed")}</p>}
        {status === "failed" && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t("failed")}</p>}
        {status === "posted" && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{t("posted")}</p>}

        <Button type="submit" size="lg" disabled={busy}>
          {status === "posting" ? t("posting") : t("post")}
        </Button>
      </form>
    </main>
  );
}

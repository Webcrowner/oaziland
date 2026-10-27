"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { createPost, CreatePostError, listMyListings, type Listing, type MediaUploadResult } from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";

const MAX_CAPTION_LENGTH = 2200;
const MAX_TAGS = 20;
const LISTING_LINK = /\/listing\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Status = "idle" | "posting" | "posted" | "blocked" | "invalid" | "failed";

export default function CreateVideoPage() {
  return (
    <Suspense fallback={null}>
      <CreateVideoForm />
    </Suspense>
  );
}

function CreateVideoForm() {
  const t = useTranslations("VideoCreatePage");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [video, setVideo] = useState<MediaUploadResult | null>(null);
  const [caption, setCaption] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [listingId, setListingId] = useState(searchParams.get("listing_id") || "");
  const [pasted, setPasted] = useState("");
  const [pastedInvalid, setPastedInvalid] = useState(false);
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [serverMessage, setServerMessage] = useState("");
  const [showMissingVideo, setShowMissingVideo] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    void Promise.resolve().then(() => setLoggedIn(Boolean(token)));
    if (!token) return;
    listMyListings(token, "PUBLISHED")
      .then((data) => setMyListings(data.results))
      .catch(() => setMyListings([]));
  }, []);

  function handleUploaded(result: MediaUploadResult) {
    if (result.media_type !== "VIDEO") return;
    setVideo(result);
    setShowMissingVideo(false);
  }

  function handlePaste(value: string) {
    setPasted(value);
    if (!value.trim()) {
      setPastedInvalid(false);
      return;
    }
    const match = value.match(LISTING_LINK);
    if (match) {
      setListingId(match[1]);
      setPastedInvalid(false);
    } else {
      setPastedInvalid(true);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "posting" || status === "posted") return;
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    if (!video) {
      setShowMissingVideo(true);
      return;
    }
    const tags = [...new Set(tagsInput.split(",").map((tag) => tag.trim().replace(/^#+/, "").trim()).filter(Boolean))].slice(0, MAX_TAGS);
    setStatus("posting");
    setServerMessage("");
    try {
      const created = await createPost({
        caption: caption.trim(),
        post_type: "REEL",
        tags,
        linked_listing_id: UUID.test(listingId) ? listingId : undefined,
        media_urls: [video.url],
      }, token);
      setStatus("posted");
      window.setTimeout(() => router.push(`/videos/${created.id}`), 900);
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
  const formatPrice = (price: string) => new Intl.NumberFormat(locale).format(Number(price));

  if (loggedIn === false) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="mb-3 text-2xl font-bold text-[var(--navy)]">{t("title")}</h1>
        <p className="mb-6 text-gray-600">{t("signInRequired")}</p>
        <Link href="/login" className="rounded bg-[var(--gold)] px-6 py-2 font-semibold text-[var(--navy)]">{t("signIn")}</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mb-6 text-sm text-gray-600">{t("subtitle")}</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4">
          {video ? (
            <div className="flex flex-col items-center gap-3">
              <video src={video.url} controls playsInline className="max-h-[26rem] rounded-xl bg-black" />
              <button type="button" onClick={() => setVideo(null)} className="text-sm font-semibold text-rose-600 hover:underline">
                {t("removeVideo")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <span className="text-4xl" aria-hidden="true">🎬</span>
              <MediaUploader
                folder="videos" multiple={false} accept="video/mp4,video/quicktime" onUploaded={handleUploaded}
                label={t("chooseVideo")}
                triggerClassName="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[var(--navy)] px-6 py-2.5 text-sm font-bold text-white hover:opacity-90"
              />
              <p className="text-xs text-slate-500">{t("videoHint")}</p>
              {showMissingVideo && <p role="alert" className="text-sm text-red-600">{t("videoRequired")}</p>}
            </div>
          )}
        </div>

        <div>
          <textarea
            rows={4} maxLength={MAX_CAPTION_LENGTH} placeholder={t("captionPlaceholder")} aria-label={t("captionPlaceholder")}
            value={caption} onChange={(e) => setCaption(e.target.value)} className="w-full rounded border px-3 py-2"
          />
          <p className="text-right text-xs text-gray-400">{caption.length}/{MAX_CAPTION_LENGTH}</p>
        </div>

        <input
          type="text" placeholder={t("tagsPlaceholder")} aria-label={t("tagsPlaceholder")} value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)} className="rounded border px-3 py-2"
        />

        <fieldset className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-700">{t("propertyLabel")}</legend>
          {myListings.length > 0 && (
            <select
              value={myListings.some((l) => l.id === listingId) ? listingId : ""}
              onChange={(e) => { setListingId(e.target.value); setPasted(""); setPastedInvalid(false); }}
              aria-label={t("propertyLabel")} className="rounded border bg-white px-3 py-2 text-sm"
            >
              <option value="">{t("noProperty")}</option>
              {myListings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.property_asset.type} · {l.property_asset.quarter_name} · {formatPrice(l.price_xaf)} XAF
                </option>
              ))}
            </select>
          )}
          <input
            type="text" value={pasted} onChange={(e) => handlePaste(e.target.value)} placeholder={t("pasteLink")} aria-label={t("pasteLink")}
            className="rounded border px-3 py-2 text-sm"
          />
          {pastedInvalid && <p role="alert" className="text-xs text-red-600">{t("linkInvalid")}</p>}
          {UUID.test(listingId) && <p className="rounded bg-[var(--gold)]/10 px-3 py-2 text-xs text-[#8A6D14]">{t("linkedProperty")}</p>}
        </fieldset>

        {status === "blocked" && <p role="alert" className="text-sm text-red-600">{t("blocked")}</p>}
        {status === "invalid" && <p role="alert" className="text-sm text-red-600">{serverMessage || t("failed")}</p>}
        {status === "failed" && <p role="alert" className="text-sm text-red-600">{t("failed")}</p>}
        {status === "posted" && <p role="status" className="text-sm text-green-700">{t("posted")}</p>}

        <button type="submit" disabled={busy} className="rounded bg-[var(--gold)] py-2.5 font-semibold text-[var(--navy)] hover:opacity-90 disabled:opacity-50">
          {status === "posting" ? t("publishing") : t("publish")}
        </button>
      </form>
    </main>
  );
}

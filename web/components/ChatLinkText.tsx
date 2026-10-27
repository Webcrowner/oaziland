"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getListing, getReel, type Listing, type ReelPost } from "@/lib/api";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const OAZILAND_PATH = /^\/(?:en|fr)\/(videos|listing)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

const cardClass =
  "mt-1.5 flex items-center gap-3 rounded-xl border border-slate-400/40 bg-slate-500/10 p-2 no-underline transition-colors hover:bg-slate-500/20";

function VideoLinkCard({ url, id }: { url: string; id: string }) {
  const t = useTranslations("ChatLinks");
  const [post, setPost] = useState<ReelPost | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReel(id, localStorage.getItem("access_token") || undefined)
      .then((data) => { if (!cancelled) setPost(data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [id]);

  const video = post?.media.find((m) => m.media_type === "VIDEO");
  return (
    <a href={url} className={cardClass}>
      {video ? (
        <video src={`${video.file_url}#t=0.5`} muted playsInline preload="metadata" className="h-16 w-12 shrink-0 rounded-lg bg-black object-cover" />
      ) : (
        <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xl" aria-hidden="true">🎬</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-extrabold uppercase tracking-wide text-amber-600">{t("watchVideo")}</span>
        {post && <span className="block truncate text-xs font-semibold">@{post.author_username}</span>}
        {post?.caption && <span className="line-clamp-1 text-xs opacity-70">{post.caption}</span>}
      </span>
      <span className="shrink-0 text-xs font-bold">{t("open")} →</span>
    </a>
  );
}

function ListingLinkCard({ url, id }: { url: string; id: string }) {
  const t = useTranslations("ChatLinks");
  const locale = useLocale();
  const [listing, setListing] = useState<Listing | null>(null);

  useEffect(() => {
    let cancelled = false;
    getListing(id)
      .then((data) => { if (!cancelled) setListing(data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [id]);

  const cover = listing?.photos.find((p) => p.media_type === "PHOTO");
  return (
    <a href={url} className={cardClass}>
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xl" aria-hidden="true">🏠</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-extrabold uppercase tracking-wide text-amber-600">{t("viewProperty")}</span>
        {listing && (
          <>
            <span className="block truncate text-xs font-semibold">{listing.property_asset.quarter_name}</span>
            <span className="block text-xs opacity-70">{new Intl.NumberFormat(locale).format(Number(listing.price_xaf))} XAF</span>
          </>
        )}
      </span>
      <span className="shrink-0 text-xs font-bold">{t("open")} →</span>
    </a>
  );
}

/**
 * Renders a chat message body with links made clickable. Links to this site's own videos and
 * listings become preview cards; every other link opens in a new tab.
 */
export default function ChatLinkText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const cards: ReactNode[] = [];

  text.split(URL_PATTERN).forEach((chunk, index) => {
    if (index % 2 === 0) {
      if (chunk) parts.push(chunk);
      return;
    }
    // Trailing punctuation belongs to the sentence, not the link.
    const trailing = chunk.match(/[.,!?;:)]+$/)?.[0] ?? "";
    const url = trailing ? chunk.slice(0, -trailing.length) : chunk;
    let card: ReactNode = null;
    try {
      const parsed = new URL(url);
      const match = typeof window !== "undefined" && parsed.host === window.location.host ? parsed.pathname.match(OAZILAND_PATH) : null;
      if (match) {
        card = match[1].toLowerCase() === "videos"
          ? <VideoLinkCard key={`v${index}`} url={url} id={match[2]} />
          : <ListingLinkCard key={`l${index}`} url={url} id={match[2]} />;
      }
    } catch {
      // Not a parseable URL: fall through to plain text.
    }
    if (card) {
      cards.push(card);
    } else {
      parts.push(
        <a key={`a${index}`} href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">
          {url}
        </a>,
      );
    }
    if (trailing) parts.push(trailing);
  });

  return (
    <>
      {parts.length > 0 && <span>{parts}</span>}
      {cards}
    </>
  );
}

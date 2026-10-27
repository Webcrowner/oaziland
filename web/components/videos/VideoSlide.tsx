"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Avatar from "@/components/Avatar";
import type { ReelPost } from "@/lib/api";
import {
  BookmarkIcon, CheckIcon, CommentIcon, HeartFilled, HeartOutline, PlayIcon, PlusIcon, ShareArrowIcon, VolumeIcon,
} from "@/components/videos/VideoIcons";

export interface VideoSlideProps {
  post: ReelPost;
  active: boolean;
  /** Only the active clip and its neighbours mount a <video>, so a long feed stays light. */
  nearby: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onLike: (post: ReelPost) => void;
  onSave: (post: ReelPost) => void;
  onFollow: (post: ReelPost) => void;
  onOpenComments: (post: ReelPost) => void;
  onOpenShare: (post: ReelPost) => void;
  onTagClick: (tag: string) => void;
  onViewed: (post: ReelPost) => void;
}

const DOUBLE_TAP_MS = 280;

function RailButton({ label, count, onClick, pressed, children }: { label: string; count?: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} aria-pressed={pressed}
      className="group flex flex-col items-center gap-1 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)] focus-visible:outline-2 focus-visible:outline-amber-300 rounded-full"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm transition-transform group-active:scale-90 md:bg-white/10 md:group-hover:bg-white/20">
        {children}
      </span>
      {count !== undefined && <span className="text-xs font-bold tabular-nums">{count}</span>}
    </button>
  );
}

export default function VideoSlide({
  post, active, nearby, muted, onToggleMute, onLike, onSave, onFollow, onOpenComments, onOpenShare, onTagClick, onViewed,
}: VideoSlideProps) {
  const t = useTranslations("VideosPage");
  const locale = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const tapTimer = useRef<number | undefined>(undefined);
  const lastTapAt = useRef(0);
  const scrubbing = useRef(false);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [expanded, setExpanded] = useState(false);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);

  const video = post.media.find((m) => m.media_type === "VIDEO");
  const poster = post.media.find((m) => m.media_type === "PHOTO")?.file_url ?? post.listing_preview?.cover_url ?? undefined;
  const liked = post.my_reaction !== null;
  const likeCount = Object.values(post.reaction_counts).reduce((sum, n) => sum + n, 0);
  const compact = new Intl.NumberFormat(locale, { notation: "compact" });
  const lp = post.listing_preview;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
  }, [muted, nearby]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (active) {
      el.play().then(() => setPaused(false)).catch(() => setPaused(true));
    } else {
      el.pause();
      el.currentTime = 0;
      if (barRef.current) barRef.current.style.width = "0%";
    }
  }, [active, nearby]);

  // A view only counts after two seconds on screen, so flicking past a clip doesn't inflate it.
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => onViewed(post), 2000);
    return () => window.clearTimeout(timer);
  }, [active, post, onViewed]);

  useEffect(() => () => window.clearTimeout(tapTimer.current), []);

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().then(() => setPaused(false)).catch(() => setPaused(true));
    } else {
      el.pause();
      setPaused(true);
    }
  }

  function handleTap(e: React.MouseEvent<HTMLDivElement>) {
    const now = Date.now();
    if (now - lastTapAt.current < DOUBLE_TAP_MS) {
      window.clearTimeout(tapTimer.current);
      lastTapAt.current = 0;
      if (!liked) onLike(post);
      const rect = e.currentTarget.getBoundingClientRect();
      const heart = { id: now, x: e.clientX - rect.left, y: e.clientY - rect.top };
      setHearts((prev) => [...prev, heart]);
      window.setTimeout(() => setHearts((prev) => prev.filter((h) => h.id !== heart.id)), 900);
      return;
    }
    lastTapAt.current = now;
    tapTimer.current = window.setTimeout(togglePlay, DOUBLE_TAP_MS);
  }

  function seekTo(e: React.PointerEvent<HTMLDivElement>) {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    if (barRef.current) barRef.current.style.width = `${ratio * 100}%`;
  }

  function handleTimeUpdate() {
    const el = videoRef.current;
    if (!el || !barRef.current || scrubbing.current || !el.duration) return;
    barRef.current.style.width = `${(el.currentTime / el.duration) * 100}%`;
  }

  function handleMetadata() {
    const el = videoRef.current;
    if (el && el.videoWidth && el.videoHeight) setFit(el.videoHeight >= el.videoWidth ? "cover" : "contain");
  }

  const hasMoreCaption = post.caption.length > 90 || post.caption.includes("\n");

  return (
    <section
      data-post-id={post.id}
      className="relative flex h-full w-full snap-start snap-always items-center justify-center md:pb-3 md:pt-24"
    >
      <div className="relative h-full w-full md:aspect-[9/16] md:w-auto">
        <div className="absolute inset-0 overflow-hidden bg-slate-950 md:rounded-2xl">
          {poster && fit === "contain" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
          )}
          {video && nearby && !failed ? (
            <video
              ref={videoRef}
              src={video.file_url}
              poster={poster}
              loop
              muted={muted}
              playsInline
              preload={active ? "auto" : "metadata"}
              onLoadedMetadata={handleMetadata}
              onTimeUpdate={handleTimeUpdate}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => { setBuffering(false); setPaused(false); }}
              onPause={() => setPaused(true)}
              onCanPlay={() => setBuffering(false)}
              onError={() => setFailed(true)}
              className={`absolute inset-0 h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
            />
          ) : (
            poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )
          )}
          {failed && (
            <p role="alert" className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-slate-300">
              {t("actionFailed")}
            </p>
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

          <div
            role="button" tabIndex={0} aria-label={paused ? t("play") : t("pause")}
            onClick={handleTap}
            onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); togglePlay(); } }}
            className="absolute inset-0 cursor-pointer select-none outline-none"
          >
            {paused && active && !failed && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/80">
                <PlayIcon size={72} />
              </span>
            )}
            {buffering && active && !paused && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="h-10 w-10 animate-spin rounded-full border-4 border-white/25 border-t-white" />
              </span>
            )}
            {hearts.map((h) => (
              <span
                key={h.id} aria-hidden="true"
                className="video-heart-burst pointer-events-none absolute text-rose-500"
                style={{ left: h.x - 44, top: h.y - 44 }}
              >
                <HeartFilled size={88} />
              </span>
            ))}
          </div>

          <div
            className="absolute inset-x-0 bottom-0 z-10 h-4 cursor-pointer touch-none"
            aria-hidden="true"
            onPointerDown={(e) => { scrubbing.current = true; e.currentTarget.setPointerCapture(e.pointerId); seekTo(e); }}
            onPointerMove={(e) => { if (scrubbing.current) seekTo(e); }}
            onPointerUp={() => { scrubbing.current = false; }}
            onPointerCancel={() => { scrubbing.current = false; }}
          >
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25 transition-[height] hover:h-1.5">
              <div ref={barRef} className="h-full w-0 bg-white" />
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-[5] pointer-events-none p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pr-20 md:pr-4">
            <div className="pointer-events-auto flex items-center gap-2">
              <Link href={`/videos?author=${post.author}`} className="truncate text-[15px] font-extrabold text-white hover:underline">
                @{post.author_username}
              </Link>
              {post.is_verified_creator && (
                <span title={t("verified")} className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-white"><CheckIcon size={10} /></span>
              )}
              {post.is_sponsored && (
                <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{t("sponsored")}</span>
              )}
            </div>

            {post.caption && (
              <p
                className={`pointer-events-auto mt-1.5 whitespace-pre-wrap break-words text-sm leading-snug text-white/95 ${expanded ? "max-h-40 overflow-y-auto" : "line-clamp-2"}`}
                onClick={() => hasMoreCaption && setExpanded((v) => !v)}
              >
                {post.caption}
              </p>
            )}
            {post.tag_names.length > 0 && (
              <div className="pointer-events-auto mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                {post.tag_names.slice(0, 5).map((tag) => (
                  <button key={tag} type="button" onClick={() => onTagClick(tag)} className="text-sm font-bold text-amber-300 hover:underline">
                    #{tag}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] font-medium text-white/60">{t("views", { count: compact.format(post.view_count) })}</p>

            {lp && (
              <Link
                href={`/listing/${lp.id}`}
                className="pointer-events-auto mt-3 flex items-center gap-3 rounded-2xl border border-white/20 bg-white/15 p-2 pr-2.5 text-white backdrop-blur-md transition-colors hover:bg-white/25"
              >
                {lp.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lp.cover_url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15 text-2xl">🏠</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-bold uppercase tracking-wide text-amber-300">
                    {lp.is_available ? (lp.listing_type === "RENT" ? t("listingForRent") : t("listingForSale")) : t("listingUnavailable")} · {lp.quarter}
                  </span>
                  <span className="block truncate text-base font-extrabold">
                    {t("priceXaf", { price: new Intl.NumberFormat(locale).format(Number(lp.price_xaf)) })}
                    {lp.listing_type === "RENT" && <span className="text-xs font-semibold text-white/70"> {t("perMonth")}</span>}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-amber-400 px-3 py-2 text-xs font-extrabold text-slate-900">{t("viewProperty")} →</span>
              </Link>
            )}
          </div>
        </div>

        <div className="absolute bottom-28 right-2 z-20 flex flex-col items-center gap-4 md:-right-[4.75rem] md:bottom-4">
          <div className="relative mb-2">
            <Link href={`/videos?author=${post.author}`} aria-label={post.author_name}>
              <Avatar src={post.author_avatar} name={post.author_name} className="h-12 w-12 rounded-full border-2 border-white bg-slate-700 text-lg font-bold text-white" />
            </Link>
            {!post.is_mine && (
              <button
                type="button" onClick={() => onFollow(post)} aria-label={post.is_following_author ? t("following") : t("follow")}
                className={`absolute -bottom-2.5 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full text-white transition-colors ${post.is_following_author ? "bg-emerald-500" : "bg-rose-500"}`}
              >
                {post.is_following_author ? <CheckIcon size={11} /> : <PlusIcon size={11} />}
              </button>
            )}
          </div>
          <RailButton label={liked ? t("unlike") : t("like")} count={compact.format(likeCount)} onClick={() => onLike(post)} pressed={liked}>
            {liked ? <HeartFilled size={28} className="text-rose-500" /> : <HeartOutline size={28} />}
          </RailButton>
          <RailButton label={t("comments")} count={compact.format(post.comment_count)} onClick={() => onOpenComments(post)}>
            <CommentIcon size={27} />
          </RailButton>
          <RailButton label={post.is_saved ? t("unsave") : t("save")} onClick={() => onSave(post)} pressed={post.is_saved}>
            <BookmarkIcon size={26} filled={post.is_saved} className={post.is_saved ? "text-amber-300" : undefined} />
          </RailButton>
          <RailButton label={t("share")} count={compact.format(post.share_count)} onClick={() => onOpenShare(post)}>
            <ShareArrowIcon size={26} />
          </RailButton>
          <RailButton label={muted ? t("unmute") : t("mute")} onClick={onToggleMute}>
            <VolumeIcon size={24} muted={muted} />
          </RailButton>
        </div>
      </div>
    </section>
  );
}

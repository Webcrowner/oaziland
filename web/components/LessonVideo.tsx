"use client";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

type Embed =
  | { type: "youtube" | "vimeo"; src: string }
  | { type: "video" | "link"; src: string };

function embedFor(url: string): Embed {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return { type: "link", src: "#" };
    const host = u.hostname.replace(/^www\./, "");
    let youtubeId: string | null = null;
    if (host === "youtu.be") youtubeId = u.pathname.slice(1);
    else if (host.endsWith("youtube.com")) {
      youtubeId = u.searchParams.get("v") ?? (u.pathname.startsWith("/embed/") ? u.pathname.split("/")[2] : null);
    }
    if (youtubeId) return { type: "youtube", src: `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?enablejsapi=1` };
    if (host === "vimeo.com" && /^\/\d+/.test(u.pathname)) return { type: "vimeo", src: `https://player.vimeo.com/video${u.pathname}` };
    if (/\.(mp4|webm|ogg|mov)$/i.test(u.pathname)) return { type: "video", src: url };
    return { type: "link", src: url };
  } catch {
    return { type: "link", src: "#" };
  }
}

/**
 * Plays a lesson video and calls onEnded once the whole video has been
 * watched. Uploaded/direct files and YouTube/Vimeo embeds are tracked;
 * for uploaded files forward-skipping past what was watched is blocked
 * until the lesson is complete. Other links can't be tracked, so the
 * learner marks those complete manually.
 */
export default function LessonVideo({
  title, fileUrl, url, completed, onEnded,
}: { title: string; fileUrl: string; url: string; completed: boolean; onEnded: () => void }) {
  const t = useTranslations("CoursePlayer");
  const embed: Embed = fileUrl ? { type: "video", src: fileUrl } : embedFor(url);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const watchedRef = useRef(0);
  const endedRef = useRef(onEnded);

  useEffect(() => {
    endedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    watchedRef.current = 0;
  }, [embed.src]);

  useEffect(() => {
    if (embed.type !== "youtube" && embed.type !== "vimeo") return;
    const origin = embed.type === "youtube" ? "https://www.youtube.com" : "https://player.vimeo.com";
    function onMessage(e: MessageEvent) {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow || typeof e.data !== "string") return;
      try {
        const data = JSON.parse(e.data);
        const finished = embed.type === "youtube"
          ? (data.event === "onStateChange" && data.info === 0) || (data.event === "infoDelivery" && data.info?.playerState === 0)
          : data.event === "finish";
        if (finished) endedRef.current();
      } catch {
        // ignore messages that aren't JSON
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed.type]);

  function subscribe() {
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    if (embed.type === "youtube") {
      frame.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "https://www.youtube.com");
      frame.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"] }), "https://www.youtube.com");
    } else if (embed.type === "vimeo") {
      frame.postMessage(JSON.stringify({ method: "addEventListener", value: "finish" }), "https://player.vimeo.com");
    }
  }

  const hint = !completed && embed.type !== "link"
    ? <p className="mt-2 text-xs text-gray-500">{t("watchToComplete")}</p>
    : null;

  if (embed.type === "video") {
    return (
      <>
        <video
          key={embed.src}
          src={embed.src}
          controls
          preload="metadata"
          className="w-full rounded bg-black"
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (!v.seeking && v.currentTime - watchedRef.current < 2) watchedRef.current = Math.max(watchedRef.current, v.currentTime);
          }}
          onSeeking={(e) => {
            const v = e.currentTarget;
            if (!completed && v.currentTime > watchedRef.current + 1) v.currentTime = watchedRef.current;
          }}
          onEnded={() => endedRef.current()}
        />
        {hint}
      </>
    );
  }
  if (embed.type === "youtube" || embed.type === "vimeo") {
    return (
      <>
        <div className="aspect-video w-full overflow-hidden rounded bg-black">
          <iframe
            key={embed.src}
            ref={frameRef}
            src={embed.src}
            title={title}
            onLoad={subscribe}
            className="h-full w-full"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        {hint}
      </>
    );
  }
  return <a href={embed.src} target="_blank" rel="noopener noreferrer" className="text-[var(--navy)] underline">{t("openVideo")}</a>;
}

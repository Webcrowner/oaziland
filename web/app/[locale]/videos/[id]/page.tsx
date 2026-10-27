import type { Metadata } from "next";
import { Suspense } from "react";
import VideoFeed from "@/components/videos/VideoFeed";
import { getReel } from "@/lib/api";

export async function generateMetadata({ params }: { params: Promise<{ id: string; locale: string }> }): Promise<Metadata> {
  const { id, locale } = await params;
  const fallback = locale === "fr" ? "Vidéo | Oaziland" : "Video | Oaziland";
  const post = await getReel(id).catch(() => null);
  if (!post) return { title: fallback, robots: { index: false } };
  const caption = post.caption.trim();
  const video = post.media.find((m) => m.media_type === "VIDEO");
  return {
    title: `${caption ? caption.slice(0, 60) : `@${post.author_username}`} | Oaziland`,
    description: caption.slice(0, 200) || fallback,
    openGraph: {
      type: "video.other",
      title: caption.slice(0, 60) || `@${post.author_username}`,
      description: caption.slice(0, 200),
      ...(video ? { videos: [{ url: video.file_url }] } : {}),
      ...(post.listing_preview?.cover_url ? { images: [{ url: post.listing_preview.cover_url }] } : {}),
    },
  };
}

export default async function SharedVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <VideoFeed initialPostId={id} />
    </Suspense>
  );
}

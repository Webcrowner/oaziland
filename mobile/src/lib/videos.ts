import type { ReelPost } from "./api";

export const MAX_VIDEO_CAPTION = 2200;
export const MAX_VIDEO_TAGS = 20;

/** 1200 -> "1.2K", 3400000 -> "3.4M": counts on the side rail have to stay narrow. */
export function compactCount(value: number): string {
  if (value < 1000) return String(Math.max(0, Math.floor(value)));
  const [divisor, suffix] = value >= 1_000_000 ? [1_000_000, "M"] : [1000, "K"];
  const scaled = Math.floor((value / divisor) * 10) / 10;
  return `${Number.isInteger(scaled) ? scaled : scaled.toFixed(1)}${suffix}`;
}

export function reactionTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** "#Bastos, ForRent,, bastos" -> ["Bastos", "ForRent"]: no hashes, no blanks, no repeats, at most 20. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.split(",")) {
    const tag = raw.trim().replace(/^#+/, "").trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags.slice(0, MAX_VIDEO_TAGS);
}

export type VideoDraftError = "noVideo" | "captionTooLong";

export function videoDraftError(draft: { videoUrl: string | null; caption: string }): VideoDraftError | null {
  if (!draft.videoUrl) return "noVideo";
  if (draft.caption.length > MAX_VIDEO_CAPTION) return "captionTooLong";
  return null;
}

export function videoPostPayload(draft: { videoUrl: string; caption: string; tagsInput: string; linkedListingId?: string }) {
  return {
    caption: draft.caption.trim(),
    post_type: "REEL" as const,
    tags: parseTags(draft.tagsInput),
    media_urls: [draft.videoUrl],
    ...(draft.linkedListingId ? { linked_listing_id: draft.linkedListingId } : {}),
  };
}

export function videoSource(post: ReelPost): string | null {
  return post.media.find((m) => m.media_type === "VIDEO")?.file_url ?? null;
}

export function videoPoster(post: ReelPost): string | null {
  return post.media.find((m) => m.media_type === "PHOTO")?.file_url ?? post.listing_preview?.cover_url ?? null;
}

/** Replaces one post in a list, leaving the others untouched. */
export function patchPost(posts: ReelPost[], id: string, changes: Partial<ReelPost>): ReelPost[] {
  return posts.map((p) => (p.id === id ? { ...p, ...changes } : p));
}

/** The result of tapping the heart: the reaction and counts to show straight away. */
export function toggledLove(post: Pick<ReelPost, "my_reaction" | "reaction_counts">): { my_reaction: string | null; reaction_counts: Record<string, number> } {
  const counts = { ...post.reaction_counts };
  if (post.my_reaction) {
    counts[post.my_reaction] = Math.max(0, (counts[post.my_reaction] ?? 1) - 1);
    if (post.my_reaction === "LOVE") return { my_reaction: null, reaction_counts: counts };
  }
  counts.LOVE = (counts.LOVE ?? 0) + 1;
  return { my_reaction: "LOVE", reaction_counts: counts };
}

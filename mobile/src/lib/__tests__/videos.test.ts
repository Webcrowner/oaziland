import type { ReelPost } from "../api";
import {
  compactCount, parseTags, patchPost, reactionTotal, toggledLove, videoDraftError, videoPostPayload, videoSource,
} from "../videos";

const post = (extra: Partial<ReelPost> = {}) =>
  ({ id: "p1", my_reaction: null, reaction_counts: {}, media: [{ id: "1", media_type: "VIDEO", file_url: "https://x/v.mp4" }], ...extra }) as ReelPost;

describe("compactCount", () => {
  it("keeps small numbers and shortens big ones", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1000)).toBe("1K");
    expect(compactCount(1250)).toBe("1.2K");
    expect(compactCount(3_400_000)).toBe("3.4M");
  });
});

describe("parseTags", () => {
  it("drops hashes, blanks and repeats and caps the list", () => {
    expect(parseTags("#Bastos, ForRent,, bastos ,  ")).toEqual(["Bastos", "ForRent"]);
    expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(",")).length).toBe(20);
  });
});

describe("video upload", () => {
  it("needs a video and a caption within the limit", () => {
    expect(videoDraftError({ videoUrl: null, caption: "" })).toBe("noVideo");
    expect(videoDraftError({ videoUrl: "u", caption: "x".repeat(2201) })).toBe("captionTooLong");
    expect(videoDraftError({ videoUrl: "u", caption: "" })).toBeNull();
  });

  it("posts a REEL with the uploaded file and only links a property when given one", () => {
    expect(videoPostPayload({ videoUrl: "u", caption: " Tour ", tagsInput: "#A" })).toEqual({
      caption: "Tour", post_type: "REEL", tags: ["A"], media_urls: ["u"],
    });
    expect(videoPostPayload({ videoUrl: "u", caption: "", tagsInput: "", linkedListingId: "L" }).linked_listing_id).toBe("L");
  });
});

describe("liking", () => {
  it("loves an unreacted post, then takes the love back", () => {
    const loved = toggledLove(post());
    expect(loved).toEqual({ my_reaction: "LOVE", reaction_counts: { LOVE: 1 } });
    expect(toggledLove(post(loved))).toEqual({ my_reaction: null, reaction_counts: { LOVE: 0 } });
  });

  it("swaps another reaction for love without double counting", () => {
    expect(toggledLove(post({ my_reaction: "LIKE", reaction_counts: { LIKE: 2 } }))).toEqual({
      my_reaction: "LOVE", reaction_counts: { LIKE: 1, LOVE: 1 },
    });
    expect(reactionTotal({ LIKE: 1, LOVE: 1 })).toBe(2);
  });
});

describe("list helpers", () => {
  it("changes one post only and finds its video", () => {
    const list = [post({ id: "a" }), post({ id: "b" })];
    expect(patchPost(list, "b", { is_saved: true }).map((p) => p.is_saved)).toEqual([undefined, true]);
    expect(videoSource(post())).toBe("https://x/v.mp4");
    expect(videoSource(post({ media: [] }))).toBeNull();
  });
});

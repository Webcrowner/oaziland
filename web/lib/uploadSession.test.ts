import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPost, uploadMediaFile } from "./api";

const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const tokenExpiring = (secondsFromNow: number) => `h.${b64({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })}.s`;

class FakeXhr {
  static sent: { auth: string }[] = [];
  static status = 201;
  upload: { onprogress?: () => void } = {};
  status = 0;
  responseText = "";
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  private auth = "";
  open() {}
  setRequestHeader(name: string, value: string) {
    if (name === "Authorization") this.auth = value;
  }
  abort() {}
  send() {
    FakeXhr.sent.push({ auth: this.auth });
    this.status = FakeXhr.status;
    this.responseText = JSON.stringify({ url: "http://localhost:8000/media/videos/a.mp4", media_type: "VIDEO" });
    this.onload?.();
  }
}

const file = new File(["x"], "a.mp4", { type: "video/mp4" });

describe("expired sign-ins", () => {
  beforeEach(() => {
    localStorage.clear();
    FakeXhr.sent = [];
    FakeXhr.status = 201;
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes an expired access token before uploading, rather than sending a big file to be refused", async () => {
    localStorage.setItem("refresh_token", "refresh-1");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ access: "fresh-token" }), { status: 200 }))));

    const result = await uploadMediaFile(file, "videos", tokenExpiring(-60));

    expect(result.media_type).toBe("VIDEO");
    expect(FakeXhr.sent).toEqual([{ auth: "Bearer fresh-token" }]);
  });

  it("uploads with a still-valid token as is", async () => {
    const token = tokenExpiring(3600);
    await uploadMediaFile(file, "videos", token);

    expect(FakeXhr.sent).toEqual([{ auth: `Bearer ${token}` }]);
  });

  it("reports an ended session when publishing is refused with 401 and nothing can be refreshed", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 401 }))));

    await expect(createPost({ caption: "x", post_type: "REEL" }, "old-token")).rejects.toMatchObject({ kind: "auth" });
  });
});

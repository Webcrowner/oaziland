import { listFeedPosts, listTopicFeed, createPost, CreatePostError, removePostReaction } from "../api";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => "stale-token"),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("social feed api", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  it("retries a feed request anonymously when the saved token is rejected", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { detail: "token_not_valid" }))
      .mockResolvedValueOnce(json(200, { count: 1, next: "http://x/?page=2", results: [{ id: "p1" }] }));
    const page = await listFeedPosts();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer stale-token");
    expect(fetchMock.mock.calls[1][1]).toBeUndefined();
    expect(page).toEqual({ count: 1, next: "http://x/?page=2", results: [{ id: "p1" }] });
  });

  it("asks the server for the requested page and encodes topic tags", async () => {
    fetchMock.mockResolvedValue(json(200, { count: 0, next: null, results: [] }));
    await listTopicFeed("Bastos & Co", 3);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/posts\/topic\/\?tag=Bastos%20%26%20Co&page=3$/);
    await listFeedPosts(1);
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/posts\/$/);
  });

  it("throws when the feed can't be loaded", async () => {
    fetchMock.mockResolvedValue(json(500, {}));
    await expect(listFeedPosts()).rejects.toThrow();
  });

  it("tells moderation, validation and network failures apart when creating a post", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { detail: "Blocked by moderation" }));
    await expect(createPost({ caption: "x" })).rejects.toMatchObject({ kind: "moderation", message: "Blocked by moderation" });

    fetchMock.mockResolvedValueOnce(json(400, { caption: ["A post needs a caption or at least one photo or video."] }));
    await expect(createPost({ caption: "" })).rejects.toMatchObject({ kind: "validation", message: expect.stringContaining("needs a caption") });

    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    const error = await createPost({ caption: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(CreatePostError);
    expect(error.kind).toBe("network");
  });

  it("removes a reaction through the dedicated endpoint", async () => {
    fetchMock.mockResolvedValue(json(200, { my_reaction: null, reaction_counts: {} }));
    const post = await removePostReaction("abc");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/posts\/abc\/remove-reaction\/$/);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(post.my_reaction).toBeNull();
  });
});

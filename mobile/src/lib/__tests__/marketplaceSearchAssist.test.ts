import { addRecentSearch, didYouMean, imageSearchError, parseRecentSearches, searchImageMime } from "../marketplaceSearchAssist";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));

describe("addRecentSearch", () => {
  it("puts the newest first without duplicates in any casing", () => {
    expect(addRecentSearch(["sofa", "Phone"], "phone")).toEqual(["phone", "sofa"]);
  });

  it("keeps at most eight and ignores one-letter searches", () => {
    const full = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"];
    expect(addRecentSearch(full, "new")).toEqual(["new", "a1", "b2", "c3", "d4", "e5", "f6", "g7"]);
    expect(addRecentSearch(full, " x ")).toBe(full);
  });
});

describe("parseRecentSearches", () => {
  it("survives missing or corrupt storage", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("not json")).toEqual([]);
    expect(parseRecentSearches('["tv", 3, " "]')).toEqual(["tv"]);
  });
});

describe("didYouMean", () => {
  it("offers a real correction only", () => {
    expect(didYouMean("sofa", "sofaa")).toBe("sofa");
    expect(didYouMean("Sofa", "sofa")).toBeNull();
    expect(didYouMean(null, "sofa")).toBeNull();
  });
});

describe("photo search helpers", () => {
  it("falls back to JPEG for types the server does not take", () => {
    expect(searchImageMime("image/png")).toBe("image/png");
    expect(searchImageMime("image/heic")).toBe("image/jpeg");
    expect(searchImageMime(null)).toBe("image/jpeg");
  });

  it("turns failures into friendly messages", () => {
    expect(imageSearchError(503)).toMatch(/isn't available/);
    expect(imageSearchError(400, "Unsupported image.")).toBe("Unsupported image.");
    expect(imageSearchError(500)).toMatch(/failed/);
  });
});

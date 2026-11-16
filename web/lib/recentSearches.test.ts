import { describe, expect, it } from "vitest";
import { addRecentSearch, parseRecentSearches, speechLang } from "./recentSearches";

describe("addRecentSearch", () => {
  it("puts the newest term first", () => {
    expect(addRecentSearch(["phone"], "laptop")).toEqual(["laptop", "phone"]);
  });

  it("moves a repeated term to the front without duplicating it, ignoring case and spacing", () => {
    expect(addRecentSearch(["phone", "Laptop"], "  laptop  ")).toEqual(["laptop", "phone"]);
    expect(addRecentSearch(["a b"], "a   b")).toEqual(["a b"]);
  });

  it("keeps at most the limit, dropping the oldest", () => {
    const full = ["1a", "2a", "3a", "4a", "5a", "6a", "7a", "8a"];
    const next = addRecentSearch(full, "new");
    expect(next).toHaveLength(8);
    expect(next[0]).toBe("new");
    expect(next).not.toContain("8a");
  });

  it("ignores blank or one-character terms", () => {
    expect(addRecentSearch(["phone"], "   ")).toEqual(["phone"]);
    expect(addRecentSearch(["phone"], "x")).toEqual(["phone"]);
  });
});

describe("parseRecentSearches", () => {
  it("returns an empty list for missing or corrupt storage", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("{oops")).toEqual([]);
    expect(parseRecentSearches('{"a":1}')).toEqual([]);
  });

  it("keeps only non-empty strings", () => {
    expect(parseRecentSearches('["phone", 3, "", "tv"]')).toEqual(["phone", "tv"]);
  });
});

describe("speechLang", () => {
  it("maps the site locale to a recognition language", () => {
    expect(speechLang("fr")).toBe("fr-FR");
    expect(speechLang("en")).toBe("en-US");
  });
});

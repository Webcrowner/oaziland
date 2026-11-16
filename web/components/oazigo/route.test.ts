import { describe, expect, it } from "vitest";
import { decodePolyline, formatDuration } from "./route";

describe("decodePolyline", () => {
  it("decodes Google's documented example", () => {
    // From Google's polyline algorithm page.
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("formatDuration", () => {
  it("shows minutes, then hours and minutes", () => {
    const labels = { min: "min", h: "h" };
    expect(formatDuration(14, labels)).toBe("14 min");
    expect(formatDuration(65, labels)).toBe("1 h 05 min");
  });
});

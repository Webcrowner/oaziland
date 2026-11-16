import { describe, expect, it } from "vitest";
import { getSpeechRecognition, imageProblem, suggestionFor, transcriptOf } from "./searchAssist";

describe("suggestionFor", () => {
  it("returns the suggestion for the current text", () => {
    expect(suggestionFor("iphne", { query: "iphne", did_you_mean: "iphone" })).toBe("iphone");
  });

  it("ignores answers for older text, identical suggestions and short input", () => {
    expect(suggestionFor("iphone", { query: "iphn", did_you_mean: "iphone" })).toBeNull();
    expect(suggestionFor("Iphone", { query: "Iphone", did_you_mean: "iphone" })).toBeNull();
    expect(suggestionFor("ip", { query: "ip", did_you_mean: "iphone" })).toBeNull();
    expect(suggestionFor("iphne", { query: "iphne", did_you_mean: null })).toBeNull();
    expect(suggestionFor("iphne", null)).toBeNull();
  });

  it("compares text ignoring extra spaces and case", () => {
    expect(suggestionFor("  Sumsung   phone ", { query: "sumsung phone", did_you_mean: "samsung phone" })).toBe("samsung phone");
  });
});

describe("imageProblem", () => {
  it("accepts small jpeg, png and webp and flags the rest", () => {
    expect(imageProblem({ type: "image/webp", size: 1000 })).toBeNull();
    expect(imageProblem({ type: "image/gif", size: 1000 })).toBe("type");
    expect(imageProblem({ type: "image/png", size: 6 * 1024 * 1024 })).toBe("size");
  });
});

describe("speech helpers", () => {
  it("finds the standard or the webkit recognizer, else null", () => {
    class Fake {}
    expect(getSpeechRecognition({ webkitSpeechRecognition: Fake })).toBe(Fake);
    expect(getSpeechRecognition({ SpeechRecognition: Fake })).toBe(Fake);
    expect(getSpeechRecognition({})).toBeNull();
    expect(getSpeechRecognition(undefined)).toBeNull();
  });

  it("reads the first transcript", () => {
    expect(transcriptOf({ results: [[{ transcript: " red shoes " }]] })).toBe("red shoes");
    expect(transcriptOf({ results: [] })).toBe("");
  });
});

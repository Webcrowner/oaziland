import * as SecureStore from "expo-secure-store";

export const MAX_RECENT_SEARCHES = 8;
const RECENT_KEY = "marketplace_recent_searches";

/** Puts a search at the front of the history, without duplicates (any casing) and capped at eight. */
export function addRecentSearch(history: string[], term: string): string[] {
  const clean = term.trim().replace(/\s+/g, " ");
  if (clean.length < 2) return history;
  const rest = history.filter((h) => h.toLowerCase() !== clean.toLowerCase());
  return [clean, ...rest].slice(0, MAX_RECENT_SEARCHES);
}

export function parseRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    return parseRecentSearches(await SecureStore.getItemAsync(RECENT_KEY));
  } catch {
    return [];
  }
}

export async function saveRecentSearches(history: string[]): Promise<void> {
  try {
    if (history.length === 0) await SecureStore.deleteItemAsync(RECENT_KEY);
    else await SecureStore.setItemAsync(RECENT_KEY, JSON.stringify(history));
  } catch {
    // History is a convenience; losing it must never break search.
  }
}

/** The suggestion to offer, or null when the server had none or it is just the query again. */
export function didYouMean(suggestion: string | null | undefined, query: string): string | null {
  const clean = suggestion?.trim();
  if (!clean || clean.toLowerCase() === query.trim().toLowerCase()) return null;
  return clean;
}

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The server takes JPEG, PNG and WebP only; anything else the picker reports is sent as JPEG, which the picker produces. */
export function searchImageMime(mime: string | null | undefined): string {
  const lower = mime?.toLowerCase();
  return lower && IMAGE_MIME.has(lower) ? lower : "image/jpeg";
}

/** A friendly message for a failed photo search. */
export function imageSearchError(status: number, detail?: string): string {
  if (status === 503) return "Photo search isn't available right now. Type what you're looking for instead.";
  if (status === 413) return "That photo is too large. Try one under 5 MB.";
  if (status === 400) return detail || "We couldn't use that photo. Try a clear JPEG, PNG or WebP picture under 5 MB.";
  return "Photo search failed. Please try again.";
}

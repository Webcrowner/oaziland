export const RECENT_SEARCHES_KEY = "oaziland_recent_searches";
export const MAX_RECENT_SEARCHES = 8;

/** Adds a term to the front, dropping blanks and case-insensitive duplicates, capped at the limit. */
export function addRecentSearch(list: string[], term: string, max: number = MAX_RECENT_SEARCHES): string[] {
  const clean = term.trim().replace(/\s+/g, " ");
  if (clean.length < 2) return list;
  const rest = list.filter((item) => item.toLowerCase() !== clean.toLowerCase());
  return [clean, ...rest].slice(0, max);
}

export function parseRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function loadRecentSearches(): string[] {
  try {
    return parseRecentSearches(localStorage.getItem(RECENT_SEARCHES_KEY));
  } catch {
    return [];
  }
}

export function saveRecentSearch(term: string): string[] {
  const next = addRecentSearch(loadRecentSearches(), term);
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Storage can be full or blocked; recent searches are a convenience only.
  }
  return next;
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function speechLang(locale: string): string {
  return locale.toLowerCase().startsWith("fr") ? "fr-FR" : "en-US";
}

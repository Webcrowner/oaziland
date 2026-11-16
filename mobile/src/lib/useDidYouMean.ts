import { useEffect, useState } from "react";
import { getMarketplaceSearchAssist } from "./api";
import { didYouMean } from "./marketplaceSearchAssist";
import { searchableQuery } from "./marketplaceSearch";

export const ASSIST_DEBOUNCE_MS = 400;

/** The server's spelling suggestion for what is being typed, looked up 400 ms after the last keystroke. */
export function useDidYouMean(query: string): string | null {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const active = searchableQuery(query);

  useEffect(() => {
    setSuggestion(null);
    if (!active) return;
    let stale = false;
    const timer = setTimeout(() => {
      getMarketplaceSearchAssist(active)
        .then((assist) => { if (!stale) setSuggestion(didYouMean(assist.did_you_mean, active)); })
        .catch(() => {});
    }, ASSIST_DEBOUNCE_MS);
    return () => { stale = true; clearTimeout(timer); };
  }, [active]);

  return suggestion;
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { listMarketplaceFeed, listMarketplaceListings, type AnyMarketplaceListing, type MarketplaceCategory } from "@/lib/api";

type FeedState = { key: string; items: FeedItem[]; total: number; page: number } | null;
export type FeedItem = AnyMarketplaceListing & { category: MarketplaceCategory };

/**
 * Browses one category, or every category at once when `category` is "all". "All" is a single request to the
 * combined feed, which merges, sorts and pages across categories on the server, so ordering, the total and
 * "load more" are exact.
 */
export function useMarketplaceFeed(category: MarketplaceCategory | "all", query: Record<string, string>) {
  const queryKey = JSON.stringify(query);
  const requestKey = `${category}|${queryKey}`;
  // Results are tagged with the request they answer, so a stale or in-flight request reads as "loading".
  const [loaded, setLoaded] = useState<FeedState>(null);
  const [failedKey, setFailedKey] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const fetchPage = useCallback(async (page: number): Promise<{ items: FeedItem[]; total: number }> => {
    const params = { ...JSON.parse(queryKey), ...(page > 1 ? { page: String(page) } : {}) };
    if (category === "all") {
      const data = await listMarketplaceFeed<FeedItem>(params);
      return { items: data.results, total: data.count };
    }
    const data = await listMarketplaceListings<AnyMarketplaceListing>(category, params);
    return { items: data.results.map((item) => ({ ...item, category })), total: data.count };
  }, [category, queryKey]);

  useEffect(() => {
    let stale = false;
    // Debounced so typing in the search box doesn't fire a request per keystroke.
    const timer = setTimeout(() => {
      setFailedKey("");
      fetchPage(1)
        .then((data) => { if (!stale) setLoaded({ key: requestKey, ...data, page: 1 }); })
        .catch(() => { if (!stale) setFailedKey(requestKey); });
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [fetchPage, requestKey, reloadKey]);

  const current = loaded?.key === requestKey ? loaded : null;
  const status: "loading" | "ready" | "error" = current ? "ready" : failedKey === requestKey ? "error" : "loading";

  const retry = useCallback(() => { setFailedKey(""); setReloadKey((k) => k + 1); }, []);

  const loadMore = useCallback(async () => {
    if (!current) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(current.page + 1);
      setLoaded((prev) => (prev && prev.key === requestKey ? { ...prev, items: [...prev.items, ...data.items], total: data.total, page: prev.page + 1 } : prev));
    } catch {
      // Leave the list as it is; the button stays so the user can try again.
    } finally {
      setLoadingMore(false);
    }
  }, [current, fetchPage, requestKey]);

  const items = current?.items ?? [];
  const total = current?.total ?? 0;
  return { items, status, hasMore: items.length < total, loadingMore, loadMore, total, retry };
}

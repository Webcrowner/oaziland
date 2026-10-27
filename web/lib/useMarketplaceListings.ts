"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listMarketplaceListings, MARKETPLACE_CATEGORIES, type AnyMarketplaceListing, type MarketplaceCategory } from "@/lib/api";

/**
 * Loads one marketplace category with the given filters, 20 at a time. Changing the filters (or bumping
 * reloadKey after a new listing is posted) restarts from page 1; loadMore appends the next page.
 */
export function useMarketplaceListings<T>(category: MarketplaceCategory, query: Record<string, string>, reloadKey = 0) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const page = useRef(1);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let stale = false;
    // Debounced so typing in the search box doesn't fire a request per keystroke.
    const timer = setTimeout(() => {
      page.current = 1;
      listMarketplaceListings<T>(category, JSON.parse(queryKey))
        .then((data) => {
          if (stale) return;
          setItems(data.results);
          setTotal(data.count);
        })
        .catch(() => { if (!stale) { setItems([]); setTotal(0); } })
        .finally(() => { if (!stale) setStatus("ready"); });
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [category, queryKey, reloadKey]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const data = await listMarketplaceListings<T>(category, { ...JSON.parse(queryKey), page: String(page.current + 1) });
      page.current += 1;
      setItems((prev) => [...prev, ...data.results]);
      setTotal(data.count);
    } catch {
      // Leave the list as it is; the button stays so the user can try again.
    } finally {
      setLoadingMore(false);
    }
  }, [category, queryKey]);

  return { items, status, hasMore: items.length < total, loadingMore, loadMore };
}

type FeedPage = { items: AnyMarketplaceListing[]; total: number; page: number };
export type FeedItem = AnyMarketplaceListing & { category: MarketplaceCategory };

const feedSorters: Record<string, (a: FeedItem, b: FeedItem) => number> = {
  newest: (a, b) => b.created_at.localeCompare(a.created_at),
  oldest: (a, b) => a.created_at.localeCompare(b.created_at),
  price_asc: (a, b) => Number(a.price_xaf) - Number(b.price_xaf),
  price_desc: (a, b) => Number(b.price_xaf) - Number(a.price_xaf),
};

/**
 * Browses one category, or every category at once when `category` is "all". The "all" feed pages each
 * category independently and merges the results in the chosen order, so "load more" keeps working.
 */
export function useMarketplaceFeed(category: MarketplaceCategory | "all", query: Record<string, string>) {
  const queryKey = JSON.stringify(query);
  const requestKey = `${category}|${queryKey}`;
  // Results are tagged with the request they answer, so a stale or in-flight request reads as "loading".
  const [loaded, setLoaded] = useState<{ key: string; pages: Partial<Record<MarketplaceCategory, FeedPage>> } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let stale = false;
    const categories = category === "all" ? MARKETPLACE_CATEGORIES : [category];
    // Debounced so typing in the search box doesn't fire a request per keystroke.
    const timer = setTimeout(async () => {
      const params = JSON.parse(queryKey);
      const results = await Promise.allSettled(
        categories.map((c) => listMarketplaceListings<AnyMarketplaceListing>(c, params).then((data) => [c, { items: data.results, total: data.count, page: 1 }] as const)),
      );
      if (stale) return;
      const fulfilled = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      setLoaded({ key: `${category}|${queryKey}`, pages: Object.fromEntries(fulfilled) });
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [category, queryKey]);

  const current = loaded?.key === requestKey ? loaded.pages : null;
  const status: "loading" | "ready" | "error" = current === null ? "loading" : Object.keys(current).length === 0 ? "error" : "ready";

  const loadMore = useCallback(async () => {
    if (!current) return;
    setLoadingMore(true);
    const params = JSON.parse(queryKey);
    const results = await Promise.allSettled(
      (Object.keys(current) as MarketplaceCategory[])
        .filter((c) => current[c]!.items.length < current[c]!.total)
        .map((c) => listMarketplaceListings<AnyMarketplaceListing>(c, { ...params, page: String(current[c]!.page + 1) }).then((data) => [c, data] as const)),
    );
    setLoaded((prev) => {
      if (!prev || prev.key !== requestKey) return prev;
      const pages = { ...prev.pages };
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const [c, data] = r.value;
        const before = pages[c];
        if (before) pages[c] = { items: [...before.items, ...data.results], total: data.count, page: before.page + 1 };
      }
      return { key: prev.key, pages };
    });
    setLoadingMore(false);
  }, [current, queryKey, requestKey]);

  const pageList = Object.values(current ?? {}) as FeedPage[];
  const items: FeedItem[] = (Object.keys(current ?? {}) as MarketplaceCategory[])
    .flatMap((c) => current![c]!.items.map((item) => ({ ...item, category: c })))
    .sort(feedSorters[query.ordering] ?? feedSorters.newest);
  const hasMore = pageList.some((p) => p.items.length < p.total);
  const total = pageList.reduce((sum, p) => sum + p.total, 0);

  return { items, status, hasMore, loadingMore, loadMore, total };
}

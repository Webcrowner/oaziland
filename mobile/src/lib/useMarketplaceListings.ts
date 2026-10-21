import { useCallback, useEffect, useRef, useState } from "react";
import { listMarketplaceListings, type MarketplaceCategory } from "./api";

/**
 * Loads one marketplace category with the given filters, 20 at a time. Changing the filters restarts from
 * page 1; reload() does the same after a new listing is posted, and loadMore appends the next page.
 */
export function useMarketplaceListings<T>(category: MarketplaceCategory, query: Record<string, string>) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
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
        .finally(() => { if (!stale) setLoading(false); });
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

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { items, loading, hasMore: items.length < total, loadingMore, loadMore, reload };
}

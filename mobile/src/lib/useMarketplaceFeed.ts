import { useCallback, useEffect, useRef, useState } from "react";
import { listMarketplaceFeed, type MarketplaceFeedListing } from "./api";

/** The cross-category feed with the given filters, 20 at a time; changing the filters restarts from page 1. */
export function useMarketplaceFeed(query: Record<string, string>, enabled = true) {
  const [items, setItems] = useState<MarketplaceFeedListing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const page = useRef(1);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    page.current = 1;
    setLoading(true);
    setFailed(false);
    listMarketplaceFeed(JSON.parse(queryKey))
      .then((data) => {
        if (stale) return;
        setItems(data.results);
        setTotal(data.count);
      })
      .catch(() => { if (!stale) { setItems([]); setTotal(0); setFailed(true); } })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [queryKey, enabled, reloadKey]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const data = await listMarketplaceFeed({ ...JSON.parse(queryKey), page: String(page.current + 1) });
      page.current += 1;
      setItems((prev) => [...prev, ...data.results]);
      setTotal(data.count);
    } catch {
      // The list stays as it is and the button remains so the user can try again.
    } finally {
      setLoadingMore(false);
    }
  }, [queryKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { items, loading, failed, hasMore: items.length < total, loadingMore, loadMore, reload };
}

"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PostCard from "@/components/PostCard";
import {
  listFeedPosts, listFollowingFeed, listMyPosts, listTopicFeed, searchPosts,
  type SocialPost, type SocialPostPage,
} from "@/lib/api";

type Tab = "forYou" | "following" | "mine";
type Phase = "loading" | "ready" | "error";

const TABS: Tab[] = ["forYou", "following", "mine"];
const EMPTY_PAGE: SocialPostPage = { count: 0, next: null, results: [] };

/**
 * The real social feed — for-you (get_recommended_feed: real estate
 * priority, boosted posts, premium creators, the dance-content
 * policy all apply here), a literal following feed, the viewer's own
 * posts, topic (#tag) browsing and a real search. Every list is paged
 * on the server and loaded here with a "Load more" button.
 */
export default function FeedPage() {
  return (
    <Suspense fallback={null}>
      <FeedContent />
    </Suspense>
  );
}

function FeedContent() {
  const t = useTranslations("FeedPage");
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "forYou");
  const [tag, setTag] = useState(searchParams.get("tag") || "");
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Only the newest request may write results, so switching tabs quickly can't show a stale list.
  const requestSeq = useRef(0);

  const fetchPage = useCallback((pageNumber: number): Promise<SocialPostPage> => {
    const token = localStorage.getItem("access_token") || undefined;
    if (tag) return listTopicFeed(tag, token, pageNumber);
    if (searchTerm) return searchPosts(searchTerm, token, pageNumber);
    if (tab === "forYou") return listFeedPosts(token, pageNumber);
    if (!token) return Promise.resolve(EMPTY_PAGE);
    return tab === "following" ? listFollowingFeed(token, pageNumber) : listMyPosts(token, pageNumber);
  }, [tab, tag, searchTerm]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    void Promise.resolve()
      .then(() => {
        setLoggedIn(!!localStorage.getItem("access_token"));
        setPhase("loading");
        setLoadMoreFailed(false);
        return fetchPage(1);
      })
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setPosts(data.results);
        setPage(1);
        setHasMore(Boolean(data.next));
        setPhase("ready");
      })
      .catch(() => {
        if (seq === requestSeq.current) setPhase("error");
      });
  }, [fetchPage, reloadKey]);

  async function handleLoadMore() {
    const seq = requestSeq.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const data = await fetchPage(page + 1);
      if (seq !== requestSeq.current) return;
      setPosts((prev) => [...prev, ...data.results.filter((p) => !prev.some((existing) => existing.id === p.id))]);
      setPage((p) => p + 1);
      setHasMore(Boolean(data.next));
    } catch {
      if (seq === requestSeq.current) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  function changeTab(next: Tab) {
    setTag("");
    setSearchTerm("");
    setQuery("");
    setTab(next);
    if (next === tab) setReloadKey((k) => k + 1);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setTag("");
    setSearchTerm(query.trim());
  }

  function clearFilter() {
    setTag("");
    setSearchTerm("");
    setQuery("");
  }

  function handleTagClick(name: string) {
    setSearchTerm("");
    setQuery("");
    setTag(name);
  }

  const filtered = Boolean(tag || searchTerm);
  const needsLogin = !filtered && tab !== "forYou" && !loggedIn;
  const emptyMessage = filtered ? t("noResults") : tab === "mine" ? t("noPostsMine") : tab === "following" ? t("noPostsFollowing") : t("noPostsYet");

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[var(--navy)]">{t("title")}</h1>
        <Link href="/feed/create" className="bg-[var(--gold)] text-[var(--navy)] font-semibold px-4 py-2 rounded text-sm hover:opacity-90">
          {t("createPost")}
        </Link>
      </div>

      <form onSubmit={handleSearch} role="search" className="mb-4">
        <input
          type="search" placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} value={query}
          onChange={(e) => setQuery(e.target.value)} className="w-full border rounded px-3 py-2 text-sm"
        />
      </form>

      <div role="tablist" className="flex gap-2 mb-6 border-b pb-4 flex-wrap">
        {TABS.map((key) => (
          <button
            key={key} type="button" role="tab" aria-selected={!filtered && tab === key} onClick={() => changeTab(key)}
            className={`px-4 py-2 rounded text-sm font-semibold ${!filtered && tab === key ? "bg-[var(--navy)] text-white" : "bg-gray-100 text-gray-700"}`}
          >
            {t(`tab.${key}`)}
          </button>
        ))}
      </div>

      {filtered && (
        <p className="flex items-center justify-between gap-2 mb-4 rounded bg-gray-50 px-3 py-2 text-sm text-gray-700">
          <span>{tag ? t("showingTopic", { tag }) : t("showingSearch", { query: searchTerm })}</span>
          <button type="button" onClick={clearFilter} className="font-semibold text-[var(--navy)] hover:underline">{t("clearFilter")}</button>
        </p>
      )}

      {needsLogin ? (
        <p className="text-gray-500">
          {tab === "mine" ? t("signInForMine") : t("signInForFollowing")}{" "}
          <Link href="/login" className="font-semibold text-[var(--navy)] hover:underline">{t("signIn")}</Link>
        </p>
      ) : phase === "loading" ? (
        <p role="status" className="text-gray-500">{t("loading")}</p>
      ) : phase === "error" ? (
        <div role="alert" className="rounded border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-3">
          <span>{t("loadFailed")}</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="font-semibold underline">{t("retry")}</button>
        </div>
      ) : posts.length === 0 ? (
        <p className="text-gray-500">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {posts.map((post) => (
            <PostCard
              key={post.id} post={post} onTagClick={handleTagClick}
              onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
            />
          ))}
          {loadMoreFailed && <p role="alert" className="text-sm text-red-600">{t("loadFailed")}</p>}
          {hasMore && (
            <button
              type="button" onClick={handleLoadMore} disabled={loadingMore}
              className="self-center border rounded px-6 py-2 text-sm font-semibold text-[var(--navy)] hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingMore ? t("loading") : t("loadMore")}
            </button>
          )}
        </div>
      )}
    </main>
  );
}

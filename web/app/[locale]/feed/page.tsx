"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import PostCard from "@/components/PostCard";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { IconMessageCircle, IconSearch, IconUsers } from "@/components/Icons";
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
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-black tracking-tight text-slate-900">{t("title")}</h1>
        <Button href="/feed/create">{t("createPost")}</Button>
      </div>

      <form onSubmit={handleSearch} role="search" className="relative mb-4">
        <IconSearch size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search" placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 shadow-sm outline-none transition-shadow placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-400/15"
        />
      </form>

      <div role="tablist" className="mb-6 flex gap-1.5 rounded-2xl bg-slate-100 p-1.5">
        {TABS.map((key) => (
          <button
            key={key} type="button" role="tab" aria-selected={!filtered && tab === key} onClick={() => changeTab(key)}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${!filtered && tab === key ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-900"}`}
          >
            {t(`tab.${key}`)}
          </button>
        ))}
      </div>

      {filtered && (
        <p className="mb-4 flex items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm font-semibold text-slate-700">
          <span>{tag ? t("showingTopic", { tag }) : t("showingSearch", { query: searchTerm })}</span>
          <button type="button" onClick={clearFilter} className="font-bold text-slate-900 hover:underline">{t("clearFilter")}</button>
        </p>
      )}

      {needsLogin ? (
        <EmptyState
          icon={<IconUsers size={28} />}
          title={tab === "mine" ? t("signInForMine") : t("signInForFollowing")}
          action={<Button href="/login">{t("signIn")}</Button>}
        />
      ) : phase === "loading" ? (
        <div role="status" aria-busy="true" aria-label={t("loading")} className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-3xl border border-slate-200/90 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-slate-100" />
                <div className="h-3 w-1/3 rounded bg-slate-100" />
              </div>
              <div className="mt-4 space-y-2">
                <div className="h-3 w-full rounded bg-slate-100" />
                <div className="h-3 w-2/3 rounded bg-slate-100" />
              </div>
              <div className="mt-4 h-40 rounded-2xl bg-slate-100" />
            </div>
          ))}
        </div>
      ) : phase === "error" ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          <span>{t("loadFailed")}</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="font-bold underline">{t("retry")}</button>
        </div>
      ) : posts.length === 0 ? (
        <EmptyState icon={<IconMessageCircle size={28} />} title={emptyMessage} />
      ) : (
        <div className="flex flex-col gap-5">
          {posts.map((post) => (
            <PostCard
              key={post.id} post={post} onTagClick={handleTagClick}
              onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
            />
          ))}
          {loadMoreFailed && <p role="alert" className="text-sm text-red-600">{t("loadFailed")}</p>}
          {hasMore && (
            <Button type="button" variant="secondary" onClick={handleLoadMore} disabled={loadingMore} className="self-center px-8">
              {loadingMore ? t("loading") : t("loadMore")}
            </Button>
          )}
        </div>
      )}
    </main>
  );
}

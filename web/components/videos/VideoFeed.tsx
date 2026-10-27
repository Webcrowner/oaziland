"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  getReel, listReels, listTrendingVideoTags, reactToPost, recordReelView, removePostReaction, toggleFollow, toggleSaveReel,
  type ReelKind, type ReelPage, type ReelPost, type ReelScope,
} from "@/lib/api";
import { IconChevronRight, IconSearch, IconX } from "@/components/Icons";
import { PlusIcon } from "@/components/videos/VideoIcons";
import VideoSlide from "@/components/videos/VideoSlide";
import CommentsSheet from "@/components/videos/CommentsSheet";
import ShareSheet from "@/components/videos/ShareSheet";

const SCOPES: ReelScope[] = ["for_you", "following", "trending", "saved"];
const KINDS: ReelKind[] = ["all", "rent", "sale", "property", "general"];
const MUTE_KEY = "oaziland-videos-muted";
type Phase = "loading" | "ready" | "error";

/**
 * The full-screen, TikTok-style video section: vertical snap-scrolling clips that autoplay
 * as they arrive, a For You / Following / Trending / Saved switcher, search with trending
 * #tags, property-type chips, and — innovation over plain video feeds — a price card on
 * every property-linked clip that opens the listing's description page. `initialPostId`
 * makes a shared /videos/<id> link open on that exact clip.
 */
export default function VideoFeed({ initialPostId }: { initialPostId?: string }) {
  const t = useTranslations("VideosPage");
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialScope = searchParams.get("scope");
  const [scope, setScope] = useState<ReelScope>(SCOPES.includes(initialScope as ReelScope) ? (initialScope as ReelScope) : "for_you");
  const [kind, setKind] = useState<ReelKind>("all");
  const [term, setTerm] = useState(searchParams.get("q") || "");
  const [tag, setTag] = useState(searchParams.get("tag") || "");
  const [author, setAuthor] = useState(searchParams.get("author") || "");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(searchParams.get("q") || "");
  const [trendingTags, setTrendingTags] = useState<{ name: string; count: number }[]>([]);

  const [posts, setPosts] = useState<ReelPost[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);
  const deepLinkPending = useRef(Boolean(initialPostId));
  const viewed = useRef(new Set<string>());
  const retryAfter = useRef(0);
  const postsRef = useRef<ReelPost[]>([]);
  useEffect(() => { postsRef.current = posts; }, [posts]);

  const tokenOrNull = () => localStorage.getItem("access_token");
  const filtered = Boolean(term || tag || author);
  const needsLogin = !loggedIn && (scope === "following" || scope === "saved");

  // Immersive mode: the page behind the full-screen player must not scroll.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void Promise.resolve().then(() => {
      setMuted(localStorage.getItem(MUTE_KEY) !== "0");
      setLoggedIn(Boolean(localStorage.getItem("access_token")));
    });
    return () => { document.body.style.overflow = previous; };
  }, []);

  const fetchPage = useCallback(
    (pageNumber: number): Promise<ReelPage> =>
      listReels({ scope, kind, q: term, tag, author }, localStorage.getItem("access_token") || undefined, pageNumber),
    [scope, kind, term, tag, author],
  );

  useEffect(() => {
    const seq = ++requestSeq.current;
    void Promise.resolve()
      .then(async () => {
        setPhase("loading");
        const feed = await fetchPage(1);
        if (!deepLinkPending.current || !initialPostId) return { data: feed, deep: false };
        const shared = await getReel(initialPostId, localStorage.getItem("access_token") || undefined).catch(() => null);
        const data = shared ? { ...feed, results: [shared, ...feed.results.filter((p) => p.id !== shared.id)] } : feed;
        return { data, deep: true };
      })
      .then(({ data, deep }) => {
        if (seq !== requestSeq.current) return;
        // Consumed only once the shared clip has actually been applied (a superseded request must not eat it).
        if (deep) deepLinkPending.current = false;
        setPosts(data.results);
        setPage(1);
        setHasMore(Boolean(data.next));
        setActiveIndex(0);
        scrollerRef.current?.scrollTo({ top: 0 });
        setPhase("ready");
      })
      .catch(() => {
        if (seq === requestSeq.current) setPhase("error");
      });
  }, [fetchPage, reloadKey, initialPostId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || Date.now() < retryAfter.current) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const data = await fetchPage(page + 1);
      if (seq !== requestSeq.current) return;
      setPosts((prev) => [...prev, ...data.results.filter((p) => !prev.some((existing) => existing.id === p.id))]);
      setPage((p) => p + 1);
      setHasMore(Boolean(data.next));
    } catch {
      // A failed prefetch shouldn't interrupt the clip being watched; try again a little later.
      retryAfter.current = Date.now() + 4000;
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, loadingMore, page]);
  const loadMoreRef = useRef(loadMore);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);

  // The most visible clip becomes the active (playing) one; nearing the end prefetches the next page.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = postsRef.current.findIndex((p) => p.id === (entry.target as HTMLElement).dataset.postId);
          if (index < 0) continue;
          setActiveIndex(index);
          if (index >= postsRef.current.length - 3) void loadMoreRef.current();
        }
      },
      { root: scroller, threshold: 0.6 },
    );
    scroller.querySelectorAll("[data-post-id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [posts.length, phase]);

  useEffect(() => {
    if (!searchOpen) return;
    searchRef.current?.focus();
    if (trendingTags.length === 0) listTrendingVideoTags().then(setTrendingTags).catch(() => undefined);
  }, [searchOpen, trendingTags.length]);

  const updatePost = useCallback((id: string, patch: Partial<ReelPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const requireLogin = useCallback(() => {
    if (localStorage.getItem("access_token")) return false;
    router.push("/login");
    return true;
  }, [router]);

  const handleLike = useCallback(async (post: ReelPost) => {
    if (requireLogin()) return;
    const token = tokenOrNull()!;
    const wasLiked = post.my_reaction !== null;
    const counts = { ...post.reaction_counts };
    if (wasLiked) {
      counts[post.my_reaction!] = Math.max(0, (counts[post.my_reaction!] ?? 1) - 1);
      updatePost(post.id, { my_reaction: null, reaction_counts: counts });
    } else {
      counts.LOVE = (counts.LOVE ?? 0) + 1;
      updatePost(post.id, { my_reaction: "LOVE", reaction_counts: counts });
    }
    try {
      const fresh = wasLiked ? await removePostReaction(post.id, token) : await reactToPost(post.id, "LOVE", token);
      updatePost(post.id, { my_reaction: fresh.my_reaction, reaction_counts: fresh.reaction_counts });
    } catch {
      updatePost(post.id, { my_reaction: post.my_reaction, reaction_counts: post.reaction_counts });
    }
  }, [requireLogin, updatePost]);

  const handleSave = useCallback(async (post: ReelPost) => {
    if (requireLogin()) return;
    updatePost(post.id, { is_saved: !post.is_saved });
    try {
      const result = await toggleSaveReel(post.id, tokenOrNull()!);
      updatePost(post.id, { is_saved: result.saved });
    } catch {
      updatePost(post.id, { is_saved: post.is_saved });
    }
  }, [requireLogin, updatePost]);

  const handleFollow = useCallback(async (post: ReelPost) => {
    if (requireLogin()) return;
    const setFollowing = (value: boolean) =>
      setPosts((prev) => prev.map((p) => (p.author === post.author ? { ...p, is_following_author: value } : p)));
    setFollowing(!post.is_following_author);
    try {
      const status = await toggleFollow(post.author, tokenOrNull()!);
      setFollowing(status.is_following);
    } catch {
      setFollowing(post.is_following_author);
    }
  }, [requireLogin]);

  const handleViewed = useCallback((post: ReelPost) => {
    if (viewed.current.has(post.id)) return;
    viewed.current.add(post.id);
    void recordReelView(post.id, tokenOrNull() || undefined);
    if (!post.is_mine) updatePost(post.id, { view_count: post.view_count + 1 });
  }, [updatePost]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      localStorage.setItem(MUTE_KEY, current ? "0" : "1");
      return !current;
    });
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const bounded = Math.max(0, Math.min(postsRef.current.length - 1, index));
    scroller.scrollTo({ top: bounded * scroller.clientHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (commentsFor || shareFor || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = postsRef.current[activeIndex];
      switch (e.key) {
        case "ArrowDown": case "PageDown": e.preventDefault(); scrollToIndex(activeIndex + 1); break;
        case "ArrowUp": case "PageUp": e.preventDefault(); scrollToIndex(activeIndex - 1); break;
        case "m": case "M": toggleMute(); break;
        case "l": case "L": if (active) void handleLike(active); break;
        case " ": {
          if (target && (target.tagName === "BUTTON" || target.tagName === "A")) return;
          e.preventDefault();
          const video = scrollerRef.current?.querySelector<HTMLVideoElement>(`[data-post-id="${active?.id}"] video`);
          if (video) { if (video.paused) void video.play(); else video.pause(); }
          break;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, commentsFor, shareFor, scrollToIndex, toggleMute, handleLike]);

  function clearFilters() {
    setTerm(""); setTag(""); setAuthor(""); setSearchInput("");
  }

  function changeScope(next: ReelScope) {
    clearFilters();
    setScope(next);
    if (next === scope) setReloadKey((k) => k + 1);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setTag(""); setAuthor("");
    setTerm(searchInput.trim());
    setSearchOpen(false);
  }

  function pickTag(name: string) {
    setTerm(""); setSearchInput(""); setAuthor("");
    setTag(name);
    setSearchOpen(false);
  }

  const commentsPost = posts.find((p) => p.id === commentsFor) ?? null;
  const sharePost = posts.find((p) => p.id === shareFor) ?? null;
  const filterLabel = tag
    ? t("showingTag", { tag })
    : term
      ? t("showingSearch", { query: term })
      : author
        ? `@${posts[0]?.author_username ?? ""}`
        : "";

  const message = needsLogin ? (
    <p className="text-center text-sm text-slate-300">
      {scope === "saved" ? t("signInSaved") : t("signInFollowing")}{" "}
      <Link href="/login" className="font-bold text-amber-300 underline">{t("signIn")}</Link>
    </p>
  ) : phase === "loading" ? (
    <div role="status" className="flex flex-col items-center gap-3 text-sm text-slate-300">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      {t("loading")}
    </div>
  ) : phase === "error" ? (
    <div role="alert" className="flex flex-col items-center gap-3 text-center text-sm text-slate-300">
      <p>{t("loadFailed")}</p>
      <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="rounded-full bg-white px-5 py-2 font-bold text-slate-900">{t("retry")}</button>
    </div>
  ) : posts.length === 0 ? (
    <p className="max-w-xs text-center text-sm text-slate-300">
      {filtered ? t("emptySearch") : scope === "following" ? t("emptyFollowing") : scope === "saved" ? t("emptySaved") : t("empty")}
    </p>
  ) : null;

  return (
    <div className="fixed inset-0 z-[80] bg-black text-white">
      <header className="absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/70 via-black/30 to-transparent pb-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3">
          <Link href="/" aria-label={t("backHome")} title={t("backHome")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:bg-white/20">
            <IconChevronRight size={22} className="rotate-180" />
          </Link>
          <nav role="tablist" aria-label={t("title")} className="flex min-w-0 flex-1 items-center justify-center gap-4 overflow-x-auto sm:gap-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SCOPES.map((key) => {
              const selected = !filtered && scope === key;
              return (
                <button
                  key={key} type="button" role="tab" aria-selected={selected} onClick={() => changeScope(key)}
                  className={`relative shrink-0 py-2 text-[15px] font-extrabold drop-shadow transition-colors ${selected ? "text-white" : "text-white/60 hover:text-white/90"}`}
                >
                  {t(`tab.${key}`)}
                  {selected && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-white" />}
                </button>
              );
            })}
          </nav>
          <button
            type="button" onClick={() => setSearchOpen((v) => !v)} aria-label={t("searchLabel")} aria-expanded={searchOpen}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm hover:bg-white/20"
          >
            <IconSearch size={20} />
          </button>
          <Link
            href="/videos/create"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3.5 text-sm font-extrabold text-slate-900 hover:bg-amber-300"
          >
            <PlusIcon size={14} /> <span className="hidden sm:inline">{t("post")}</span>
          </Link>
        </div>

        <div className="mx-auto mt-1.5 flex max-w-5xl items-center gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {KINDS.map((key) => (
            <button
              key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold backdrop-blur-sm transition-colors ${kind === key ? "bg-white text-slate-900" : "bg-black/35 text-white hover:bg-white/20"}`}
            >
              {t(`kind.${key}`)}
            </button>
          ))}
          {filtered && (
            <button
              type="button" onClick={clearFilters}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-extrabold text-slate-900"
            >
              {filterLabel} <IconX size={12} aria-label={t("clearFilter")} />
            </button>
          )}
        </div>

        {searchOpen && (
          <div className="mx-auto mt-2 max-w-xl px-3">
            <form onSubmit={submitSearch} role="search" className="flex items-center gap-2 rounded-2xl bg-white p-2 text-slate-900 shadow-2xl">
              <IconSearch size={18} className="ml-2 shrink-0 text-slate-400" />
              <input
                ref={searchRef} type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("searchPlaceholder")} aria-label={t("searchLabel")}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
              />
              <button type="submit" className="rounded-xl bg-slate-900 px-4 py-1.5 text-sm font-bold text-white">{t("search")}</button>
            </form>
            {trendingTags.length > 0 && (
              <div className="mt-2 rounded-2xl bg-slate-900/90 p-3 backdrop-blur-md">
                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-amber-300">{t("trendingTags")}</p>
                <div className="flex flex-wrap gap-2">
                  {trendingTags.map((item) => (
                    <button key={item.name} type="button" onClick={() => pickTag(item.name)} className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold hover:bg-white/20">
                      #{item.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      <div
        ref={scrollerRef}
        className="h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {message ? (
          <div className="flex h-full items-center justify-center px-6">{message}</div>
        ) : (
          <>
            {posts.map((post, index) => (
              <div key={post.id} className="h-full w-full snap-start snap-always">
                <VideoSlide
                  post={post}
                  active={index === activeIndex}
                  nearby={Math.abs(index - activeIndex) <= 1}
                  muted={muted}
                  onToggleMute={toggleMute}
                  onLike={handleLike}
                  onSave={handleSave}
                  onFollow={handleFollow}
                  onOpenComments={(p) => setCommentsFor(p.id)}
                  onOpenShare={(p) => setShareFor(p.id)}
                  onTagClick={pickTag}
                  onViewed={handleViewed}
                />
              </div>
            ))}
            {!hasMore && posts.length > 0 && (
              <div className="flex h-full w-full snap-start snap-always flex-col items-center justify-center gap-4 text-center">
                <p className="text-lg font-extrabold">{t("endOfFeed")}</p>
                <button type="button" onClick={() => scrollToIndex(0)} className="rounded-full bg-white px-5 py-2 text-sm font-bold text-slate-900">
                  {t("tab.for_you")}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="pointer-events-none absolute bottom-3 left-4 z-20 hidden text-[11px] text-white/40 lg:block">{t("shortcuts")}</p>

      {commentsPost && (
        <CommentsSheet
          post={commentsPost} loggedIn={loggedIn} onClose={() => setCommentsFor(null)}
          onCountChange={(id, count) => updatePost(id, { comment_count: count })}
        />
      )}
      {sharePost && (
        <ShareSheet
          post={sharePost} loggedIn={loggedIn} onClose={() => setShareFor(null)}
          onShared={(id, count) => updatePost(id, { share_count: count })}
        />
      )}
    </div>
  );
}

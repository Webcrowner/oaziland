"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PostCard from "@/components/PostCard";
import { listFeedPosts, listFollowingFeed, searchPosts, type SocialPost } from "@/lib/api";

type Tab = "forYou" | "following";

/**
 * The real social feed — for-you (get_recommended_feed: real estate
 * priority, boosted posts, premium creators, the dance-content
 * policy all apply here) and a literal following feed, plus a real
 * search. This is the page every ranking/boost/policy fix this
 * session has been building toward.
 */
export default function FeedPage() {
  const t = useTranslations("FeedPage");
  const [tab, setTab] = useState<Tab>("forYou");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [query, setQuery] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token") || undefined;
    setLoggedIn(!!token);
    if (tab === "following") {
      if (!token) {
        setPosts([]);
        return;
      }
      listFollowingFeed(token).then((data) => setPosts(data.results)).catch(() => {});
    } else {
      listFeedPosts(token).then((data) => setPosts(data.results)).catch(() => {});
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) {
      load();
      return;
    }
    const data = await searchPosts(query);
    setPosts(data.results);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[var(--navy)]">{t("title")}</h1>
        <Link href="/feed/create" className="bg-[var(--gold)] text-[var(--navy)] font-semibold px-4 py-2 rounded text-sm hover:opacity-90">
          {t("createPost")}
        </Link>
      </div>

      <form onSubmit={handleSearch} className="mb-4">
        <input
          type="text" placeholder={t("searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </form>

      <div className="flex gap-2 mb-6 border-b pb-4">
        <button
          onClick={() => setTab("forYou")}
          className={`px-4 py-2 rounded text-sm font-semibold ${tab === "forYou" ? "bg-[var(--navy)] text-white" : "bg-gray-100 text-gray-700"}`}
        >
          {t("tabForYou")}
        </button>
        <button
          onClick={() => setTab("following")}
          className={`px-4 py-2 rounded text-sm font-semibold ${tab === "following" ? "bg-[var(--navy)] text-white" : "bg-gray-100 text-gray-700"}`}
        >
          {t("tabFollowing")}
        </button>
      </div>

      {tab === "following" && !loggedIn ? (
        <p className="text-gray-500">{t("signInForFollowing")}</p>
      ) : posts.length === 0 ? (
        <p className="text-gray-500">{t("noPostsYet")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </main>
  );
}

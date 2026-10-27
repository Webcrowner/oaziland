import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  listFeedPosts, listFollowingFeed, listMyPosts, listTopicFeed, searchPosts,
  SocialPost, PaginatedResponse,
} from "../lib/api";
import PostCard from "../components/PostCard";

type Props = NativeStackScreenProps<RootStackParamList, "Feed">;
type Tab = "forYou" | "following" | "mine";
type Phase = "loading" | "ready" | "error";

const TABS: { key: Tab; label: string }[] = [
  { key: "forYou", label: "For You" },
  { key: "following", label: "Following" },
  { key: "mine", label: "My posts" },
];

/**
 * The mobile equivalent of the real social feed built on web: for-you
 * (the recommendation algorithm), a literal following feed, the
 * viewer's own posts, topic (#tag) browsing and search. Every list is
 * paged on the server and loaded here with a "Load more" button.
 */
export default function FeedScreen({ navigation, route }: Props) {
  const [tab, setTab] = useState<Tab>(route.params?.tab ?? "forYou");
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  // Only the newest request may write results, so switching tabs quickly can't show a stale list.
  const requestSeq = useRef(0);

  const requestedTab = route.params?.tab;
  useEffect(() => {
    if (requestedTab) {
      setTag("");
      setSearchTerm("");
      setQuery("");
      setTab(requestedTab);
    }
  }, [requestedTab]);

  const filtered = Boolean(tag || searchTerm);

  const fetchPage = useCallback((pageNumber: number): Promise<PaginatedResponse<SocialPost>> => {
    if (tag) return listTopicFeed(tag, pageNumber);
    if (searchTerm) return searchPosts(searchTerm, pageNumber);
    if (tab === "following") return listFollowingFeed(pageNumber);
    if (tab === "mine") return listMyPosts(pageNumber);
    return listFeedPosts(pageNumber);
  }, [tab, tag, searchTerm]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setPhase("loading");
    setLoadMoreFailed(false);
    try {
      const token = await SecureStore.getItemAsync("access_token");
      setLoggedIn(!!token);
      if (!token && !filtered && tab !== "forYou") {
        if (seq !== requestSeq.current) return;
        setPosts([]);
        setHasMore(false);
        setPhase("ready");
        return;
      }
      const data = await fetchPage(1);
      if (seq !== requestSeq.current) return;
      setPosts(data.results);
      setPage(1);
      setHasMore(Boolean(data.next));
      setPhase("ready");
    } catch {
      if (seq === requestSeq.current) setPhase("error");
    }
  }, [fetchPage, filtered, tab]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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
    if (next === tab) void load();
    else setTab(next);
  }

  function handleSearch() {
    setTag("");
    setSearchTerm(query.trim());
  }

  function clearFilter() {
    setTag("");
    setSearchTerm("");
    setQuery("");
  }

  function handleTagPress(name: string) {
    setSearchTerm("");
    setQuery("");
    setTag(name);
  }

  const needsLogin = !filtered && tab !== "forYou" && !loggedIn;
  const emptyMessage = filtered
    ? "No posts match this search."
    : tab === "mine" ? "You haven't posted anything yet."
    : tab === "following" ? "Posts from people you follow will appear here."
    : "Nothing here yet.";

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Feed</Text>
        <TouchableOpacity style={styles.createButton} onPress={() => navigation.navigate("CreatePost", {})}>
          <Text style={styles.createButtonText}>Create Post</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.searchInput} placeholder="Search posts..." value={query}
        onChangeText={setQuery} onSubmitEditing={handleSearch} returnKeyType="search"
      />

      <View style={styles.tabRow}>
        {TABS.map(({ key, label }) => {
          const selected = !filtered && tab === key;
          return (
            <TouchableOpacity key={key} style={[styles.tab, selected && styles.tabSelected]} onPress={() => changeTab(key)}>
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {filtered && (
        <View style={styles.filterBanner}>
          <Text style={styles.filterText}>{tag ? `Posts tagged #${tag}` : `Results for “${searchTerm}”`}</Text>
          <TouchableOpacity onPress={clearFilter}>
            <Text style={styles.filterClear}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {needsLogin ? (
        <Text style={styles.empty}>{tab === "mine" ? "Sign in to see your posts." : "Sign in to see posts from people you follow."}</Text>
      ) : phase === "loading" ? (
        <ActivityIndicator color="#1B2A4A" size="large" style={{ marginTop: 30 }} />
      ) : phase === "error" ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>We couldn't load the feed. Check your connection and try again.</Text>
          <TouchableOpacity onPress={() => void load()}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{emptyMessage}</Text>}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onTagPress={handleTagPress}
              onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
              onOpenListing={(listingId) => navigation.navigate("ListingDetail", { listingId })}
            />
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              {loadMoreFailed && <Text style={styles.errorText}>We couldn't load more posts. Please try again.</Text>}
              {hasMore && (
                <TouchableOpacity style={styles.loadMore} onPress={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.loadMoreText}>Load more</Text>}
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: "bold", color: "#1B2A4A" },
  createButton: { backgroundColor: "#C9A227", borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14 },
  createButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 12 },
  searchInput: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13 },
  tabRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tab: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6, backgroundColor: "#F3F4F6" },
  tabSelected: { backgroundColor: "#1B2A4A" },
  tabText: { color: "#374151", fontSize: 13, fontWeight: "600" },
  tabTextSelected: { color: "#fff" },
  filterBanner: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginHorizontal: 16, marginBottom: 12, padding: 10, borderRadius: 6, backgroundColor: "#F9FAFB" },
  filterText: { fontSize: 13, color: "#374151", flexShrink: 1 },
  filterClear: { fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 30 },
  errorBox: { margin: 16, padding: 14, borderRadius: 8, backgroundColor: "#FEF2F2", alignItems: "center", gap: 8 },
  errorText: { color: "#B91C1C", fontSize: 13, textAlign: "center" },
  retryText: { color: "#B91C1C", fontWeight: "700", textDecorationLine: "underline" },
  footer: { alignItems: "center", gap: 8 },
  loadMore: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 28 },
  loadMoreText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
});

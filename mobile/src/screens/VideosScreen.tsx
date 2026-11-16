import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Share, StyleSheet, Text, TextInput, TouchableOpacity, View, type ViewToken } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  listReels, recordReelShare, recordReelView, reactToPost, removePostReaction, toggleFollow, toggleSaveReel,
  type PaginatedResponse, type ReelPost, type ReelScope,
} from "../lib/api";
import { patchPost, toggledLove } from "../lib/videos";
import ReelSlide from "../components/videos/ReelSlide";
import ReelComments from "../components/videos/ReelComments";
import ReelMore from "../components/videos/ReelMore";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

type Props = NativeStackScreenProps<RootStackParamList, "Videos">;
type Phase = "loading" | "ready" | "error";

const SCOPES: ReelScope[] = ["for_you", "following", "trending", "saved"];

/**
 * The full-screen, TikTok-style video feed: swipe up for the next clip, the visible one plays on a loop, and
 * every clip has like, comments, save, share, follow, report and (for your own) delete. It is the same
 * /api/posts/reels/ feed the website uses, so videos posted on either show up on both.
 */
export default function VideosScreen({ navigation }: Props) {
  const { t, locale } = useI18n();
  const focused = useIsFocused();
  const [scope, setScope] = useState<ReelScope>("for_you");
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [posts, setPosts] = useState<ReelPost[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [height, setHeight] = useState(0);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);

  const listRef = useRef<FlatList<ReelPost>>(null);
  // Only the newest request may write results, so switching tabs quickly can't show a stale list.
  const requestSeq = useRef(0);
  const viewed = useRef(new Set<string>());

  const filtered = Boolean(tag || searchTerm);
  const needsLogin = !loggedIn && (scope === "following" || scope === "saved");

  const fetchPage = useCallback(
    (pageNumber: number): Promise<PaginatedResponse<ReelPost>> => listReels(scope, pageNumber, { q: searchTerm, tag }),
    [scope, searchTerm, tag],
  );

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setPhase("loading");
    try {
      setLoggedIn(!!(await SecureStore.getItemAsync("access_token")));
      const data = await fetchPage(1);
      if (seq !== requestSeq.current) return;
      setPosts(data.results);
      setPage(1);
      setHasMore(Boolean(data.next));
      setActiveIndex(0);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      setPhase("ready");
    } catch {
      if (seq === requestSeq.current) setPhase("error");
    }
  }, [fetchPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || phase !== "ready") return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const data = await fetchPage(page + 1);
      if (seq !== requestSeq.current) return;
      setPosts((prev) => [...prev, ...data.results.filter((p) => !prev.some((q) => q.id === p.id))]);
      setPage((n) => n + 1);
      setHasMore(Boolean(data.next));
    } catch {
      // A failed prefetch shouldn't interrupt the clip being watched; the next scroll retries.
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, loadingMore, page, phase]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setActiveIndex(first.index);
  });
  const viewability = useRef({ itemVisiblePercentThreshold: 80 });

  // A clip counts as viewed once, the first time it becomes the one on screen.
  const activePost = posts[activeIndex];
  const activeId = activePost?.id;
  useEffect(() => {
    if (!activeId || !focused || viewed.current.has(activeId)) return;
    viewed.current.add(activeId);
    void recordReelView(activeId);
  }, [activeId, focused]);

  const update = (id: string, changes: Partial<ReelPost>) => setPosts((prev) => patchPost(prev, id, changes));

  async function requireSignIn(): Promise<boolean> {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) Alert.alert(t("videos.signInNeeded"));
    return !!token;
  }

  async function handleLike(post: ReelPost) {
    if (!(await requireSignIn())) return;
    const before = { my_reaction: post.my_reaction, reaction_counts: post.reaction_counts };
    const wasLoved = post.my_reaction === "LOVE";
    update(post.id, toggledLove(post));
    try {
      const fresh = wasLoved ? await removePostReaction(post.id) : await reactToPost(post.id, "LOVE");
      update(post.id, { my_reaction: fresh.my_reaction, reaction_counts: fresh.reaction_counts });
    } catch {
      update(post.id, before);
    }
  }

  async function handleSave(post: ReelPost) {
    if (!(await requireSignIn())) return;
    update(post.id, { is_saved: !post.is_saved });
    try {
      const result = await toggleSaveReel(post.id);
      update(post.id, { is_saved: result.saved });
    } catch {
      update(post.id, { is_saved: post.is_saved });
    }
  }

  async function handleFollow(post: ReelPost) {
    if (!(await requireSignIn())) return;
    try {
      const status = await toggleFollow(post.author);
      setPosts((prev) => prev.map((p) => (p.author === post.author ? { ...p, is_following_author: status.is_following } : p)));
    } catch {
      Alert.alert(t("common.actionFailedTitle"), t("common.actionFailedBody"));
    }
  }

  async function handleShare(post: ReelPost) {
    try {
      const link = `https://oaziland.com/${locale.toLowerCase().startsWith("fr") ? "fr" : "en"}/videos/${post.id}`;
      const result = await Share.share({ message: t("videos.shareMessage", { link }) });
      if (result.action === Share.sharedAction && (await SecureStore.getItemAsync("access_token"))) {
        const counted = await recordReelShare(post.id);
        update(post.id, { share_count: counted.share_count });
      }
    } catch {
      // Closing the share sheet, or a share count that could not be recorded, is not worth an error.
    }
  }

  function pickTag(name: string) {
    setQuery("");
    setSearchTerm("");
    setTag(name);
  }

  function clearFilter() {
    setTag("");
    setQuery("");
    setSearchTerm("");
    setSearchOpen(false);
  }

  const commentsPost = posts.find((p) => p.id === commentsFor) ?? null;
  const morePost = posts.find((p) => p.id === moreFor) ?? null;
  const modalOpen = Boolean(commentsPost || morePost);

  const message =
    needsLogin ? (scope === "saved" ? t("videos.signInSaved") : t("videos.signInFollowing"))
    : phase === "error" ? t("videos.loadFailed")
    : phase === "ready" && posts.length === 0
      ? filtered ? t("videos.emptyFiltered") : scope === "following" ? t("videos.emptyFollowing") : scope === "saved" ? t("videos.emptySaved") : t("videos.empty")
      : "";

  return (
    <View style={styles.container}>
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.tabs}>
          {SCOPES.map((key) => (
            <TouchableOpacity key={key} onPress={() => { clearFilter(); setScope(key); }}>
              <Text style={[styles.tab, !filtered && scope === key && styles.tabOn]}>{t(`videos.tab.${key}` as MessageKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => setSearchOpen((open) => !open)} accessibilityLabel={t("videos.search")}><Text style={styles.actionGlyph}>🔍</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("CreateVideo", {})} accessibilityLabel={t("videos.post")}><Text style={styles.actionGlyph}>＋</Text></TouchableOpacity>
        </View>
      </View>

      {searchOpen && (
        <TextInput
          style={styles.search} value={query} onChangeText={setQuery} placeholder={t("videos.search")} placeholderTextColor="#9CA3AF"
          returnKeyType="search" autoFocus
          onSubmitEditing={() => {
            const term = query.trim();
            setTag("");
            setSearchTerm(term.startsWith("#") && term.length > 1 ? "" : term);
            if (term.startsWith("#") && term.length > 1) setTag(term.slice(1));
            setSearchOpen(false);
          }}
        />
      )}
      {filtered && (
        <TouchableOpacity style={styles.filterChip} onPress={clearFilter}>
          <Text style={styles.filterText}>{t("videos.showing", { filter: tag ? `#${tag}` : searchTerm })}  ✕</Text>
        </TouchableOpacity>
      )}

      <View style={styles.stage} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
        {message ? (
          <View style={styles.center}>
            <Text style={styles.message}>{message}</Text>
            {phase === "error" && !needsLogin && (
              <TouchableOpacity style={styles.retry} onPress={() => void load()}><Text style={styles.retryText}>{t("common.tryAgain")}</Text></TouchableOpacity>
            )}
          </View>
        ) : phase === "loading" || height === 0 ? (
          <View style={styles.center}><ActivityIndicator color="#fff" size="large" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={posts}
            keyExtractor={(p) => p.id}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            decelerationRate="fast"
            getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
            onViewableItemsChanged={onViewable.current}
            viewabilityConfig={viewability.current}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={1.5}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            removeClippedSubviews
            renderItem={({ item, index }) => (
              <ReelSlide
                post={item}
                height={height}
                active={focused && !modalOpen && index === activeIndex}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                onLike={handleLike}
                onSave={handleSave}
                onFollow={handleFollow}
                onOpenComments={(p) => setCommentsFor(p.id)}
                onShare={handleShare}
                onOpenMore={(p) => setMoreFor(p.id)}
                onTagPress={pickTag}
                onOpenListing={(listingId) => navigation.navigate("ListingDetail", { listingId })}
              />
            )}
          />
        )}
      </View>

      {commentsPost && (
        <ReelComments
          post={commentsPost} loggedIn={loggedIn} onClose={() => setCommentsFor(null)}
          onCountChange={(id, count) => update(id, { comment_count: count })}
        />
      )}
      {morePost && (
        <ReelMore
          post={morePost} loggedIn={loggedIn} onClose={() => setMoreFor(null)}
          onDeleted={(id) => { setMoreFor(null); setPosts((prev) => prev.filter((p) => p.id !== id)); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  stage: { flex: 1 },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingTop: 10 },
  tabs: { flexDirection: "row", gap: 14 },
  tab: { color: "rgba(255,255,255,0.65)", fontWeight: "700", fontSize: 14, textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 3 },
  tabOn: { color: "#fff", textDecorationLine: "underline" },
  actions: { flexDirection: "row", gap: 16, alignItems: "center" },
  actionGlyph: { color: "#fff", fontSize: 22, textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 3 },
  search: { position: "absolute", top: 48, left: 12, right: 12, zIndex: 11, backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  filterChip: { position: "absolute", top: 48, alignSelf: "center", zIndex: 10, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  filterText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  message: { color: "#fff", textAlign: "center", fontSize: 15 },
  retry: { marginTop: 14, borderWidth: 1, borderColor: "#fff", borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8 },
  retryText: { color: "#fff", fontWeight: "700" },
});

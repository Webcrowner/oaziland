import { useState, useCallback } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { listFeedPosts, listFollowingFeed, searchPosts, SocialPost } from "../lib/api";
import PostCard from "../components/PostCard";

type Props = NativeStackScreenProps<RootStackParamList, "Feed">;
type Tab = "forYou" | "following";

/**
 * The mobile equivalent of the real social feed built on web this
 * session — the biggest gap found in the whole review: the entire
 * recommendation algorithm (real estate priority, boosted posts,
 * premium creators, the dance-content policy) has been built and
 * tested against a feature that had NO mobile UI at all until now.
 */
export default function FeedScreen({ navigation }: Props) {
  const [tab, setTab] = useState<Tab>("forYou");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [query, setQuery] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    SecureStore.getItemAsync("access_token").then(async (token) => {
      setLoggedIn(!!token);
      try {
        if (tab === "following") {
          if (!token) {
            setPosts([]);
            return;
          }
          const data = await listFollowingFeed();
          setPosts(data.results);
        } else {
          const data = await listFeedPosts();
          setPosts(data.results);
        }
      } catch {
        setPosts([]);
      } finally {
        setLoading(false);
      }
    });
  }, [tab]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSearch() {
    if (!query.trim()) {
      load();
      return;
    }
    setLoading(true);
    try {
      const data = await searchPosts(query);
      setPosts(data.results);
    } finally {
      setLoading(false);
    }
  }

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
        <TouchableOpacity style={[styles.tab, tab === "forYou" && styles.tabSelected]} onPress={() => setTab("forYou")}>
          <Text style={[styles.tabText, tab === "forYou" && styles.tabTextSelected]}>For You</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === "following" && styles.tabSelected]} onPress={() => setTab("following")}>
          <Text style={[styles.tabText, tab === "following" && styles.tabTextSelected]}>Following</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#1B2A4A" size="large" style={{ marginTop: 30 }} />
      ) : tab === "following" && !loggedIn ? (
        <Text style={styles.empty}>Sign in to see posts from people you follow.</Text>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
          renderItem={({ item }) => (
            <PostCard post={item} onOpenListing={(listingId) => navigation.navigate("ListingDetail", { listingId })} />
          )}
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
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 30 },
});

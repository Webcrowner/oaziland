import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getMarketplaceShop, toggleFollow, type BrowsableCategory, type MarketplaceShop } from "../lib/api";
import { followerLabel, policyText, vacationNotice } from "../lib/marketplaceShop";
import { useMarketplaceFeed } from "../lib/useMarketplaceFeed";
import { memberSinceLabel, replyTimeLabel } from "../lib/sellerTrust";
import MarketplaceListingCard from "../components/MarketplaceListingCard";
import LoadMoreButton from "../components/LoadMoreButton";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceShop">;
type Tab = "listings" | "deals" | "about" | "policies";

function ShopListings({ userId, dealsOnly, onOpen }: { userId: string; dealsOnly: boolean; onOpen: (category: BrowsableCategory, id: string) => void }) {
  const query: Record<string, string> = dealsOnly ? { lister_id: userId, on_sale: "1", ordering: "ending_soon" } : { lister_id: userId, ordering: "newest" };
  const { items, loading, failed, hasMore, loadingMore, loadMore } = useMarketplaceFeed(query);
  if (loading) return <ActivityIndicator color="#1B2A4A" style={styles.status} />;
  if (items.length === 0) {
    return <Text style={styles.empty}>{failed ? "Could not load the listings. Please try again." : dealsOnly ? "No flash deals from this shop right now." : "This shop has no listings yet."}</Text>;
  }
  return (
    <View>
      {items.map((item) => <MarketplaceListingCard key={`${item.category}-${item.id}`} listing={item} onPress={() => onOpen(item.category, item.id)} />)}
      {hasMore ? <LoadMoreButton onPress={loadMore} loading={loadingMore} /> : null}
    </View>
  );
}

/** A seller's public storefront: banner, trust details, announcement, and their listings, deals, about and policies. */
export default function MarketplaceShopScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  const [shop, setShop] = useState<MarketplaceShop | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("listings");
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState("");

  const load = useCallback(() => {
    getMarketplaceShop(userId)
      .then((data) => { setShop(data); setState("ready"); })
      .catch((err) => { setError(err instanceof Error ? err.message : "Could not load the shop."); setState("failed"); });
  }, [userId]);

  useEffect(() => {
    load();
    return navigation.addListener("focus", load);
  }, [load, navigation]);

  async function handleFollow() {
    if (!shop) return;
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      navigation.navigate("Login");
      return;
    }
    setFollowBusy(true);
    setFollowError("");
    try {
      const result = await toggleFollow(userId);
      setShop({ ...shop, is_following: result.is_following, follower_count: result.follower_count });
    } catch (err) {
      setFollowError(err instanceof Error ? err.message : "Could not update follow status.");
    } finally {
      setFollowBusy(false);
    }
  }

  if (state === "loading") return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  if (state === "failed" || !shop) return <View style={styles.centered}><Text style={styles.empty}>{error || "This shop could not be found."}</Text></View>;

  const openListing = (category: BrowsableCategory, id: string) =>
    navigation.navigate("MarketplaceListingDetail", { category, listingId: id });
  const seller = shop.seller;
  const tabs: { key: Tab; label: string }[] = [
    { key: "listings", label: `Listings (${shop.listing_count})` },
    { key: "deals", label: `Deals (${shop.deal_count})` },
    { key: "about", label: "About" },
    { key: "policies", label: "Policies" },
  ];
  const vacation = shop.on_vacation ? vacationNotice(shop) : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {shop.banner_url ? <Image source={{ uri: shop.banner_url }} style={styles.banner} /> : <View style={[styles.banner, styles.bannerEmpty]} />}
      <View style={styles.header}>
        <View style={styles.identity}>
          {shop.logo_url ? <Image source={{ uri: shop.logo_url }} style={styles.logo} /> : (
            <View style={[styles.logo, styles.logoEmpty]}><Text style={styles.logoInitial}>{(shop.name || seller.name || "?").charAt(0).toUpperCase()}</Text></View>
          )}
          <View style={styles.identityText}>
            <Text style={styles.name}>{shop.name || seller.name}</Text>
            {shop.tagline ? <Text style={styles.tagline}>{shop.tagline}</Text> : null}
          </View>
        </View>
        <Text style={styles.stats}>
          {seller.rating_avg != null ? `★ ${seller.rating_avg} (${seller.rating_count})` : "No ratings yet"} · {seller.items_sold} sold · {followerLabel(shop.follower_count)}
        </Text>
        {seller.id_verified && <Text style={styles.verified}>✓ ID verified</Text>}
        {shop.is_owner ? (
          <TouchableOpacity style={styles.secondary} onPress={() => navigation.navigate("MarketplaceShopSettings")}>
            <Text style={styles.secondaryText}>Edit my shop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.follow, shop.is_following && styles.following, followBusy && styles.disabled]} disabled={followBusy} onPress={handleFollow}>
            {followBusy ? <ActivityIndicator color="#1B2A4A" /> : <Text style={[styles.followText, shop.is_following && styles.followingText]}>{shop.is_following ? "Unfollow" : "Follow"}</Text>}
          </TouchableOpacity>
        )}
        {followError ? <Text style={styles.error}>{followError}</Text> : null}
      </View>

      {shop.announcement ? <View style={styles.announcement}><Text style={styles.announcementText}>📣 {shop.announcement}</Text></View> : null}
      {shop.coupon_available ? <Text style={styles.couponHint}>🏷 This shop has discount codes. Enter a code at checkout.</Text> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabOn]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.body}>
        {(tab === "listings" || tab === "deals") && (vacation ? (
          <View style={styles.vacation}>
            <Text style={styles.vacationTitle}>🏖 {vacation.title}</Text>
            <Text style={styles.vacationBody}>{vacation.body}</Text>
          </View>
        ) : (
          <ShopListings key={tab} userId={userId} dealsOnly={tab === "deals"} onOpen={openListing} />
        ))}

        {tab === "about" && (
          <View>
            <Text style={styles.sectionTitle}>About this shop</Text>
            <Text style={styles.text}>{shop.description?.trim() || "This seller has not written a description yet."}</Text>
            <Text style={styles.sectionTitle}>Seller</Text>
            <Text style={styles.text}>{memberSinceLabel(seller.member_since)}</Text>
            <Text style={styles.text}>{seller.items_sold} sold · {seller.active_listings} active {seller.active_listings === 1 ? "listing" : "listings"}</Text>
            {seller.reply_time_hours != null && seller.reply_rate_pct != null && (
              <Text style={styles.text}>⏱ {replyTimeLabel(seller.reply_time_hours)} · {seller.reply_rate_pct}% reply rate</Text>
            )}
          </View>
        )}

        {tab === "policies" && (
          <View>
            <Text style={styles.sectionTitle}>Shipping policy</Text>
            <Text style={styles.text}>{policyText(shop.shipping_policy, "shipping")}</Text>
            <Text style={styles.sectionTitle}>Return policy</Text>
            <Text style={styles.text}>{policyText(shop.return_policy, "returns")}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 32 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  banner: { height: 140, width: "100%" },
  bannerEmpty: { backgroundColor: "#1B2A4A" },
  header: { padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  identity: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  logo: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: "#C9A227", backgroundColor: "#fff" },
  logoEmpty: { backgroundColor: "#1B2A4A", justifyContent: "center", alignItems: "center" },
  logoInitial: { color: "#fff", fontSize: 26, fontWeight: "700" },
  identityText: { flex: 1 },
  name: { fontSize: 20, fontWeight: "700", color: "#1B2A4A" },
  tagline: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  stats: { fontSize: 13, color: "#4B5563", marginBottom: 6 },
  verified: { alignSelf: "flex-start", fontSize: 11, fontWeight: "700", color: "#166534", backgroundColor: "#DCFCE7", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden", marginBottom: 8 },
  follow: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  following: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#1B2A4A" },
  followText: { color: "#1B2A4A", fontWeight: "700" },
  followingText: { color: "#1B2A4A" },
  secondary: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  secondaryText: { color: "#1B2A4A", fontWeight: "700" },
  disabled: { opacity: 0.5 },
  error: { color: "#DC2626", fontSize: 13, marginTop: 6 },
  announcement: { backgroundColor: "#FFFBEB", borderBottomWidth: 1, borderBottomColor: "#C9A227", padding: 12 },
  announcementText: { color: "#92400E", fontSize: 13, fontWeight: "600" },
  couponHint: { backgroundColor: "#F0FDF4", color: "#166534", fontSize: 13, padding: 10 },
  tabs: { gap: 8, padding: 12 },
  tab: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: "#fff" },
  tabOn: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  tabText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  tabTextOn: { color: "#fff" },
  body: { paddingHorizontal: 16 },
  status: { marginTop: 24 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 32 },
  vacation: { backgroundColor: "#FFFBEB", borderRadius: 10, borderWidth: 1, borderColor: "#C9A227", padding: 16 },
  vacationTitle: { fontSize: 16, fontWeight: "700", color: "#92400E", marginBottom: 4 },
  vacationBody: { fontSize: 14, color: "#92400E" },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginTop: 12, marginBottom: 4 },
  text: { fontSize: 14, color: "#374151", lineHeight: 20 },
});

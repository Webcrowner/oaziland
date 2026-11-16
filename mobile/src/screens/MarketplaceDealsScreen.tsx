import { FlatList, View, Text, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useMarketplaceFeed } from "../lib/useMarketplaceFeed";
import MarketplaceListingCard from "../components/MarketplaceListingCard";
import LoadMoreButton from "../components/LoadMoreButton";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceDeals">;

const DEALS_QUERY = { on_sale: "1", ordering: "ending_soon" };

/** Running flash sales, the ones ending soonest first. */
export default function MarketplaceDealsScreen({ navigation }: Props) {
  const { items, loading, failed, hasMore, loadingMore, loadMore, reload } = useMarketplaceFeed(DEALS_QUERY);

  if (loading) return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => `${item.category}-${item.id}`}
      contentContainerStyle={styles.list}
      onRefresh={reload}
      refreshing={false}
      ListHeaderComponent={<Text style={styles.subtitle}>Limited-time prices on goods. The deals ending soonest come first.</Text>}
      ListFooterComponent={hasMore ? <LoadMoreButton onPress={loadMore} loading={loadingMore} /> : null}
      ListEmptyComponent={<Text style={styles.empty}>{failed ? "Could not load the flash deals. Pull down to try again." : "No flash sales are running right now. Check back soon."}</Text>}
      renderItem={({ item }) => (
        <MarketplaceListingCard listing={item} onPress={() => navigation.navigate("MarketplaceListingDetail", { category: item.category, listingId: item.id })} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  subtitle: { color: "#6B7280", fontSize: 13, marginBottom: 14 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
});

import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { listMarketplaceListings } from "../lib/api";
import type { MarketplaceCategory } from "../lib/api";
import { PRICE_BASIS_LABELS } from "../lib/marketplaceFilters";
import { searchableQuery, searchMarketplace, type MarketplaceSearchOutcome, type MarketplaceSearchResult } from "../lib/marketplaceSearch";

const CATEGORY_LABELS: Record<MarketplaceCategory, string> = { warehouses: "Warehouse", stores: "Store", businesses: "Business", cars: "Car" };

/** One search box across warehouses, stores, businesses and cars; mirrors the web marketplace page. */
export default function MarketplaceUnifiedSearch({ onOpen }: { onOpen: (result: MarketplaceSearchResult) => void }) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<MarketplaceSearchOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const active = searchableQuery(query);

  useEffect(() => {
    if (!active) {
      setOutcome(null);
      setLoading(false);
      return;
    }
    let stale = false;
    setLoading(true);
    // Debounced so typing doesn't fire four requests per keystroke.
    const timer = setTimeout(async () => {
      const next = await searchMarketplace(active, listMarketplaceListings);
      if (stale) return;
      setOutcome(next);
      setLoading(false);
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [active]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input} placeholder="Search warehouses, stores, businesses and cars" value={query}
        onChangeText={setQuery} returnKeyType="search" autoCorrect={false} accessibilityLabel="Search the marketplace"
      />
      {active && loading && <ActivityIndicator color="#1B2A4A" style={styles.status} />}
      {active && !loading && outcome?.failed && <Text style={styles.error}>Marketplace search is unavailable right now. Please try again.</Text>}
      {active && !loading && outcome && !outcome.failed && (
        <View style={styles.results}>
          {outcome.partial && <Text style={styles.partial}>Some categories could not be searched. The available results are shown below.</Text>}
          {outcome.results.length === 0 ? (
            <Text style={styles.empty}>No marketplace listings match your search.</Text>
          ) : outcome.results.map((result) => (
            <TouchableOpacity key={`${result.category}-${result.id}`} style={styles.row} onPress={() => onOpen(result)}>
              <View style={styles.rowText}>
                <Text style={styles.title} numberOfLines={1}>{result.title}</Text>
                <Text style={styles.meta}>
                  {CATEGORY_LABELS[result.category]} · {PRICE_BASIS_LABELS[result.price_basis] ?? result.price_basis}{result.quarter_name ? ` · ${result.quarter_name}` : ""}
                </Text>
              </View>
              <Text style={styles.price}>{Number(result.price_xaf).toLocaleString()} XAF</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12, fontSize: 14, backgroundColor: "#fff" },
  status: { marginTop: 12 },
  error: { color: "#B91C1C", fontSize: 13, marginTop: 10 },
  results: { marginTop: 10, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  partial: { backgroundColor: "#FFFBEB", color: "#92400E", fontSize: 12, padding: 10 },
  empty: { color: "#6B7280", fontSize: 13, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  rowText: { flex: 1, paddingRight: 10 },
  title: { fontWeight: "700", color: "#1B2A4A", fontSize: 14 },
  meta: { color: "#6B7280", fontSize: 12, marginTop: 2 },
  price: { fontWeight: "700", color: "#1B2A4A", fontSize: 13 },
});

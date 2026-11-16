import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { getTrendingMarketplaceSearches, listMarketplaceListings, searchMarketplaceByImage } from "../lib/api";
import type { BrowsableCategory } from "../lib/api";
import { PRICE_BASIS_LABELS } from "../lib/marketplaceFilters";
import { searchableQuery, searchMarketplace, type MarketplaceSearchOutcome, type MarketplaceSearchResult } from "../lib/marketplaceSearch";
import { addRecentSearch, loadRecentSearches, saveRecentSearches, searchImageMime } from "../lib/marketplaceSearchAssist";
import { isOnSale, unitPriceXaf } from "../lib/flashSale";
import { pickPhoto, type PhotoSource } from "../lib/pickImage";
import { useDidYouMean } from "../lib/useDidYouMean";
import DidYouMeanBanner from "./DidYouMeanBanner";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

/** One search box across warehouses, stores, businesses, cars and goods; mirrors the web marketplace page. */
export default function MarketplaceUnifiedSearch({ onOpen }: { onOpen: (result: MarketplaceSearchResult) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<MarketplaceSearchOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [trending, setTrending] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = searchableQuery(query);
  const suggestion = useDidYouMean(query);

  useEffect(() => {
    loadRecentSearches().then(setRecent);
    getTrendingMarketplaceSearches(7).then((rows) => setTrending(rows.map((r) => r.term).slice(0, 8))).catch(() => {});
    return () => { if (blurTimer.current) clearTimeout(blurTimer.current); };
  }, []);

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

  const remember = useCallback((term: string) => {
    setRecent((prev) => {
      const next = addRecentSearch(prev, term);
      if (next !== prev) saveRecentSearches(next);
      return next;
    });
  }, []);

  function clearRecent() {
    setRecent([]);
    saveRecentSearches([]);
  }

  function pickTerm(term: string) {
    setQuery(term);
    setPhotoError("");
    remember(term);
  }

  async function searchByPhoto(source: PhotoSource) {
    setPhotoError("");
    setPhotoBusy(true);
    try {
      const photo = await pickPhoto(source);
      if (!photo) return;
      const result = await searchMarketplaceByImage(photo.uri, searchImageMime(photo.mimeType));
      const term = (result.q || result.keywords.join(" ")).trim();
      if (!term) {
        setPhotoError(t("mkt.search.photoUnclear"));
        return;
      }
      pickTerm(term);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : t("mkt.search.photoFailed"));
    } finally {
      setPhotoBusy(false);
    }
  }

  function handlePhotoPress() {
    Alert.alert(t("mkt.search.photoTitle"), t("mkt.search.photoBody"), [
      { text: t("mkt.search.takePhoto"), onPress: () => searchByPhoto("camera") },
      { text: t("mkt.search.choosePhoto"), onPress: () => searchByPhoto("library") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  const showSuggestions = focused && query.trim().length === 0 && (recent.length > 0 || trending.length > 0);

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input} placeholder={t("mkt.search.placeholder")} value={query}
          onChangeText={setQuery} returnKeyType="search" autoCorrect={false} accessibilityLabel={t("mkt.search.label")}
          onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocused(true); }}
          // Delayed so a tap on a recent or trending chip still lands before the list disappears.
          onBlur={() => { blurTimer.current = setTimeout(() => setFocused(false), 200); }}
          onSubmitEditing={() => active && remember(active)}
        />
        <TouchableOpacity style={styles.photoButton} onPress={handlePhotoPress} disabled={photoBusy} accessibilityLabel={t("mkt.search.photoTitle")}>
          {photoBusy ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.photoIcon}>📷</Text>}
        </TouchableOpacity>
      </View>
      {photoError ? <Text style={styles.error}>{photoError}</Text> : null}
      <DidYouMeanBanner suggestion={suggestion} onPick={pickTerm} />

      {showSuggestions && (
        <View style={styles.suggestions}>
          {recent.length > 0 && (
            <View>
              <View style={styles.suggestionHeader}>
                <Text style={styles.suggestionTitle}>{t("mkt.search.recent")}</Text>
                <TouchableOpacity onPress={clearRecent}><Text style={styles.clear}>{t("mkt.search.clear")}</Text></TouchableOpacity>
              </View>
              {recent.map((term) => (
                <TouchableOpacity key={term} style={styles.recentRow} onPress={() => pickTerm(term)}>
                  <Text style={styles.recentText}>🕘 {term}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {trending.length > 0 && (
            <View>
              <Text style={styles.suggestionTitle}>{t("mkt.search.trending")}</Text>
              <View style={styles.chips}>
                {trending.map((term) => (
                  <TouchableOpacity key={term} style={styles.chip} onPress={() => pickTerm(term)}>
                    <Text style={styles.chipText}>{term}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {active && loading && <ActivityIndicator color="#1B2A4A" style={styles.status} />}
      {active && !loading && outcome?.failed && <Text style={styles.error}>{t("mkt.search.unavailable")}</Text>}
      {active && !loading && outcome && !outcome.failed && (
        <View style={styles.results}>
          {outcome.partial && <Text style={styles.partial}>{t("mkt.search.partial")}</Text>}
          {outcome.results.length === 0 ? (
            <Text style={styles.empty}>{t("mkt.search.noMatch")}</Text>
          ) : outcome.results.map((result) => (
            <TouchableOpacity key={`${result.category}-${result.id}`} style={styles.row} onPress={() => { remember(active); onOpen(result); }}>
              <View style={styles.rowText}>
                <Text style={styles.title} numberOfLines={1}>{result.title}</Text>
                <Text style={styles.meta}>
                  {t(`mkt.catOne.${result.category}` as MessageKey)} · {result.price_basis in PRICE_BASIS_LABELS ? t(`mkt.basis.${result.price_basis}` as MessageKey) : result.price_basis}{result.quarter_name ? ` · ${result.quarter_name}` : ""}
                </Text>
              </View>
              <View style={styles.priceBox}>
                <Text style={[styles.price, isOnSale(result) && styles.priceSale]}>{unitPriceXaf(result).toLocaleString()} XAF</Text>
                {isOnSale(result) && <Text style={styles.saleTag}>{t("mkt.sale")}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12, fontSize: 14, backgroundColor: "#fff" },
  photoButton: { width: 46, height: 46, borderRadius: 10, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  photoIcon: { fontSize: 20 },
  status: { marginTop: 12 },
  error: { color: "#B91C1C", fontSize: 13, marginBottom: 8 },
  suggestions: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 8 },
  suggestionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  suggestionTitle: { fontSize: 12, fontWeight: "700", color: "#6B7280", textTransform: "uppercase", marginBottom: 6 },
  clear: { fontSize: 12, fontWeight: "700", color: "#B91C1C" },
  recentRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  recentText: { fontSize: 14, color: "#1B2A4A" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#F9FAFB" },
  chipText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  results: { marginTop: 2, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  partial: { backgroundColor: "#FFFBEB", color: "#92400E", fontSize: 12, padding: 10 },
  empty: { color: "#6B7280", fontSize: 13, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  rowText: { flex: 1, paddingRight: 10 },
  title: { fontWeight: "700", color: "#1B2A4A", fontSize: 14 },
  meta: { color: "#6B7280", fontSize: 12, marginTop: 2 },
  priceBox: { alignItems: "flex-end" },
  price: { fontWeight: "700", color: "#1B2A4A", fontSize: 13 },
  priceSale: { color: "#B91C1C" },
  saleTag: { fontSize: 10, fontWeight: "700", color: "#fff", backgroundColor: "#DC2626", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginTop: 2, overflow: "hidden" },
});

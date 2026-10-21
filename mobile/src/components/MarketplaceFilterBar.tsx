import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { MARKETPLACE_SORTS, MARKETPLACE_PRICE_BASES, type MarketplaceFilters } from "../lib/marketplaceFilters";

/** Search, price type, price range and sort controls shared by the four marketplace category screens. */
export default function MarketplaceFilterBar({
  value, onChange, showPriceBasis = true,
}: {
  value: MarketplaceFilters;
  onChange: (next: MarketplaceFilters) => void;
  showPriceBasis?: boolean;
}) {
  const set = (patch: Partial<MarketplaceFilters>) => onChange({ ...value, ...patch });

  return (
    <View style={styles.container}>
      <TextInput style={styles.input} placeholder="Search listings" value={value.q} onChangeText={(q) => set({ q })} returnKeyType="search" />
      <View style={styles.priceRow}>
        <TextInput style={[styles.input, styles.half]} placeholder="Min price" value={value.minPrice} onChangeText={(minPrice) => set({ minPrice })} keyboardType="numeric" />
        <TextInput style={[styles.input, styles.half]} placeholder="Max price" value={value.maxPrice} onChangeText={(maxPrice) => set({ maxPrice })} keyboardType="numeric" />
      </View>
      {showPriceBasis && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {MARKETPLACE_PRICE_BASES.map((b) => (
            <TouchableOpacity key={b.value || "any"} style={[styles.chip, value.priceBasis === b.value && styles.chipActive]} onPress={() => set({ priceBasis: b.value })}>
              <Text style={[styles.chipText, value.priceBasis === b.value && styles.chipTextActive]}>{b.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {MARKETPLACE_SORTS.map((s) => (
          <TouchableOpacity key={s.value} style={[styles.chip, value.ordering === s.value && styles.chipActive]} onPress={() => set({ ordering: s.value })}>
            <Text style={[styles.chipText, value.ordering === s.value && styles.chipTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14, backgroundColor: "#fff" },
  priceRow: { flexDirection: "row", gap: 8 },
  half: { flex: 1 },
  chips: { gap: 6, paddingBottom: 8 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff" },
  chipActive: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipText: { fontSize: 12, color: "#374151" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
});

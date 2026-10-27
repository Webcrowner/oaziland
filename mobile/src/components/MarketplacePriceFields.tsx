import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { LISTING_PRICE_BASES } from "../lib/marketplacePricing";

/** Price, price type (sale or rent period) and, for rentals, the refundable security deposit. */
export default function MarketplacePriceFields({
  price, onPriceChange, priceBasis, onPriceBasisChange, deposit, onDepositChange,
}: {
  price: string;
  onPriceChange: (price: string) => void;
  priceBasis: string;
  onPriceBasisChange: (priceBasis: string) => void;
  deposit: string;
  onDepositChange: (deposit: string) => void;
}) {
  return (
    <View>
      <Text style={styles.label}>Price type</Text>
      <View style={styles.chips}>
        {LISTING_PRICE_BASES.map((basis) => (
          <TouchableOpacity key={basis.value} style={[styles.chip, priceBasis === basis.value && styles.chipActive]} onPress={() => onPriceBasisChange(basis.value)}>
            <Text style={[styles.chipText, priceBasis === basis.value && styles.chipTextActive]}>{basis.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput style={styles.input} placeholder="Price (XAF)" value={price} onChangeText={onPriceChange} keyboardType="numeric" />
      {priceBasis !== "SALE" && (
        <TextInput style={styles.input} placeholder="Refundable security deposit (XAF, optional)" value={deposit} onChangeText={onDepositChange} keyboardType="numeric" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipActive: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipText: { fontSize: 12, color: "#374151" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 14 },
});

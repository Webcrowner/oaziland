import { View, Text, TextInput, Switch, StyleSheet } from "react-native";
import { attachListingCondition, type MarketplaceCategory } from "../lib/api";
import {
  CONDITION_TARGETS, conditionsAreEmpty, conditionsPayload, FLAG_LABELS, FLAGS_BY_CATEGORY, hasLeaseTerm, MAX_CLAUSE_LENGTH,
  type ConditionsDraft,
} from "../lib/marketplaceConditions";

/** Saves a draft for a listing; a brand-new listing with nothing entered needs no request. */
export async function saveConditions(category: MarketplaceCategory, listingId: string, draft: ConditionsDraft, skipIfEmpty = false) {
  if (skipIfEmpty && conditionsAreEmpty(category, draft)) return;
  await attachListingCondition({ target_content_type: CONDITION_TARGETS[category], target_id: listingId, ...conditionsPayload(category, draft) });
}

/** Optional terms a buyer or renter sees before paying: lease length, deposit, insurance and a free-text clause. */
export default function MarketplaceConditionsFields({
  category, value, onChange,
}: {
  category: MarketplaceCategory;
  value: ConditionsDraft;
  onChange: (next: ConditionsDraft) => void;
}) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Conditions & rules (optional)</Text>
      <Text style={styles.hint}>Buyers and renters see these before paying. They cannot be changed while an order is active.</Text>
      {hasLeaseTerm(category) && (
        <TextInput
          style={styles.input} placeholder="Minimum lease (months)" value={value.minLeaseMonths} keyboardType="number-pad" maxLength={3}
          onChangeText={(minLeaseMonths) => onChange({ ...value, minLeaseMonths })}
        />
      )}
      {category === "cars" && (
        <TextInput
          style={styles.input} placeholder="Mileage cap (km)" value={value.mileageCapKm} keyboardType="number-pad" maxLength={7}
          onChangeText={(mileageCapKm) => onChange({ ...value, mileageCapKm })}
        />
      )}
      {FLAGS_BY_CATEGORY[category].map((key) => (
        <View key={key} style={styles.switchRow}>
          <Text style={styles.switchLabel}>{FLAG_LABELS[key]}</Text>
          <Switch value={Boolean(value.flags[key])} onValueChange={(checked) => onChange({ ...value, flags: { ...value.flags, [key]: checked } })} />
        </View>
      ))}
      <TextInput
        style={[styles.input, styles.multiline]} placeholder="Anything else buyers or renters should know" value={value.clause}
        multiline numberOfLines={3} maxLength={MAX_CLAUSE_LENGTH} onChangeText={(clause) => onChange({ ...value, clause })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 12, marginBottom: 12 },
  title: { fontWeight: "700", color: "#1B2A4A", fontSize: 14, marginBottom: 2 },
  hint: { color: "#6B7280", fontSize: 12, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14 },
  multiline: { textAlignVertical: "top", minHeight: 70 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  switchLabel: { fontSize: 14, color: "#374151", flex: 1, paddingRight: 8 },
});

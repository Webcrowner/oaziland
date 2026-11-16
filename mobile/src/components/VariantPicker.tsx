import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { GoodsVariant } from "../lib/api";
import { isValueAvailable, optionNames, optionValues, selectOption, type VariantSelection } from "../lib/goodsVariants";
import { useI18n } from "../i18n";

interface Props {
  variants: GoodsVariant[];
  selection: VariantSelection;
  onChange: (next: VariantSelection) => void;
}

/** One row of chips per option name (Colour, Size...); a value with nothing in stock is disabled and says so. */
export default function VariantPicker({ variants, selection, onChange }: Props) {
  const { t } = useI18n();
  return (
    <View>
      {optionNames(variants).map((name) => (
        <View key={name} style={styles.group}>
          <Text style={styles.label}>{name}</Text>
          <View style={styles.chips}>
            {optionValues(variants, name).map((value) => {
              const on = selection[name] === value;
              const available = isValueAvailable(variants, name, value);
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.chip, on && styles.chipOn, !available && styles.chipOff]}
                  disabled={!available}
                  onPress={() => onChange(selectOption(variants, selection, name, value))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !available }}
                  accessibilityLabel={available ? `${name}: ${value}` : `${name}: ${value}, ${t("variants.outOfStock")}`}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn, !available && styles.chipTextOff]} numberOfLines={1}>{value}</Text>
                  {!available && <Text style={styles.soldOut}>{t("variants.outOfStock")}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: 8 },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, minWidth: 44, maxWidth: "100%", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipOff: { backgroundColor: "#F3F4F6", borderStyle: "dashed" },
  chipText: { fontSize: 14, color: "#1B2A4A", fontWeight: "600" },
  chipTextOn: { color: "#fff" },
  chipTextOff: { color: "#9CA3AF", textDecorationLine: "line-through" },
  soldOut: { fontSize: 10, color: "#B91C1C", marginTop: 1 },
});

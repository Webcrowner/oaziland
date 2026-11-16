import { View, Text, StyleSheet } from "react-native";
import { isOnSale, unitPriceXaf, type SaleFields } from "../lib/flashSale";
import { useCountdown } from "../lib/useCountdown";
import { formatXaf } from "../lib/marketplaceCart";
import { compareAtDisplay, percentBadge } from "../lib/compareAt";
import { useI18n } from "../i18n";

export function SaleBadge() {
  return <Text style={styles.badge}>SALE</Text>;
}

/** "-25%" next to a struck-through original price. */
export function PercentBadge({ percent }: { percent: number }) {
  const label = percentBadge(percent);
  return label ? <Text style={styles.percent}>{label}</Text> : null;
}

/** "Ends in 2d 4h", counting live seconds in the last hour. */
export function SaleCountdown({ endsAt }: { endsAt: string | null | undefined }) {
  const label = useCountdown(endsAt);
  return label ? <Text style={styles.countdown}>⏱ {label}</Text> : null;
}

/**
 * The price a buyer pays now. During a flash sale the normal price is struck through beside it; a goods
 * "original price" is struck through (with a -NN% badge) while it is above the price shown; an item with
 * options shows "From X XAF".
 */
export default function SalePrice({
  listing, large = false, showCountdown = true,
}: { listing: SaleFields; large?: boolean; showCountdown?: boolean }) {
  const { t } = useI18n();
  const onSale = isOnSale(listing);
  const priceStyle = large ? styles.priceLarge : styles.price;

  if (listing.has_variants && listing.price_from_xaf) {
    return (
      <View>
        <View style={styles.row}>
          {onSale && <SaleBadge />}
          <Text style={[priceStyle, onSale && styles.salePrice]}>{t("variants.priceFrom", { price: formatXaf(listing.price_from_xaf) })}</Text>
        </View>
        {onSale && showCountdown && <SaleCountdown endsAt={listing.sale_ends_at} />}
      </View>
    );
  }

  const shown = onSale ? unitPriceXaf(listing) : Number(listing.price_xaf);
  const compare = compareAtDisplay(listing.compare_at_price_xaf, shown);
  if (!onSale && !compare) return <Text style={priceStyle}>{formatXaf(listing.price_xaf)}</Text>;
  const was = Math.max(compare?.amount ?? 0, onSale ? Number(listing.price_xaf) : 0);
  return (
    <View>
      <View style={styles.row}>
        {onSale && <SaleBadge />}
        <Text style={[priceStyle, onSale && styles.salePrice]}>{formatXaf(shown)}</Text>
        <Text style={styles.struck}>{formatXaf(was)}</Text>
        {compare && was === compare.amount && <PercentBadge percent={compare.percent} />}
      </View>
      {onSale && showCountdown && <SaleCountdown endsAt={listing.sale_ends_at} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  badge: { backgroundColor: "#DC2626", color: "#fff", fontSize: 11, fontWeight: "700", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  percent: { backgroundColor: "#DCFCE7", color: "#166534", fontSize: 11, fontWeight: "700", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  price: { fontSize: 16, fontWeight: "700", color: "#1B2A4A" },
  priceLarge: { fontSize: 20, fontWeight: "700", color: "#1B2A4A" },
  salePrice: { color: "#B91C1C" },
  struck: { fontSize: 13, color: "#6B7280", textDecorationLine: "line-through" },
  countdown: { fontSize: 12, fontWeight: "700", color: "#B45309", marginTop: 2 },
});

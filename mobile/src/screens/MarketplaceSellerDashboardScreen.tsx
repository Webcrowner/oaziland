import { useState, useEffect, useCallback, useRef } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Share } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  getSellerDashboard, listSellerPayouts, fetchSellerSalesCsv,
  type SellerDashboard, type SellerPayoutRow, type SellerPeriod,
} from "../lib/api";
import {
  DEFAULT_SELLER_PERIOD, SELLER_PERIODS, barHeights, bucketLabel, formatXaf, labelEvery, netBreakdown, periodLabel, salesCsvTitle, viewsLabel,
} from "../lib/sellerDashboard";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceSellerDashboard">;

const CATEGORY_LABELS: Record<string, string> = { warehouses: "Warehouses", stores: "Stores", businesses: "Businesses", cars: "Cars", goods: "Goods" };
const CHART_HEIGHT = 120;
const BAR_WIDTH = 22;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <View style={[styles.kpi, accent && styles.kpiAccent]}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {hint ? <Text style={styles.kpiHint}>{hint}</Text> : null}
    </View>
  );
}

/** What the seller earned on the marketplace: totals, a net-per-period chart, fees, categories, top listings and payouts. */
export default function MarketplaceSellerDashboardScreen({ navigation }: Props) {
  const [period, setPeriod] = useState<SellerPeriod>(DEFAULT_SELLER_PERIOD);
  const [data, setData] = useState<SellerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [payouts, setPayouts] = useState<SellerPayoutRow[]>([]);
  const [payoutPage, setPayoutPage] = useState(1);
  const [hasMorePayouts, setHasMorePayouts] = useState(false);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [payoutError, setPayoutError] = useState("");
  const [exporting, setExporting] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (which: SellerPeriod) => {
    const id = ++requestId.current;
    setLoading(true);
    setPayoutsLoading(true);
    setError("");
    setPayoutError("");
    setSelected(null);
    const [dashboard, firstPage] = await Promise.allSettled([getSellerDashboard(which), listSellerPayouts(which, 1)]);
    if (id !== requestId.current) return;
    if (dashboard.status === "fulfilled") setData(dashboard.value);
    else {
      setData(null);
      setError(dashboard.reason instanceof Error ? dashboard.reason.message : "Could not load your sales dashboard.");
    }
    if (firstPage.status === "fulfilled") {
      setPayouts(firstPage.value.results);
      setPayoutPage(1);
      setHasMorePayouts(!!firstPage.value.next);
    } else {
      setPayouts([]);
      setHasMorePayouts(false);
      setPayoutError(firstPage.reason instanceof Error ? firstPage.reason.message : "Could not load your payouts.");
    }
    setLoading(false);
    setPayoutsLoading(false);
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  async function loadMorePayouts() {
    const id = requestId.current;
    setPayoutsLoading(true);
    setPayoutError("");
    try {
      const next = await listSellerPayouts(period, payoutPage + 1);
      if (id !== requestId.current) return;
      setPayouts((prev) => [...prev, ...next.results]);
      setPayoutPage((page) => page + 1);
      setHasMorePayouts(!!next.next);
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : "Could not load more payouts.");
    } finally {
      setPayoutsLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const csv = await fetchSellerSalesCsv(period);
      await Share.share({ message: csv, title: salesCsvTitle(period) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export your sales.");
    } finally {
      setExporting(false);
    }
  }

  const summary = data?.summary;
  const points = data?.series.points ?? [];
  const bucket = data?.series.bucket ?? "day";
  const heights = barHeights(points, CHART_HEIGHT);
  const every = labelEvery(points.length);
  const breakdown = summary ? netBreakdown(summary) : null;
  const picked = selected !== null ? points[selected] : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.chips}>
        {SELLER_PERIODS.map((p) => (
          <TouchableOpacity key={p.key} style={[styles.chip, period === p.key && styles.chipActive]} onPress={() => setPeriod(p.key)}>
            <Text style={[styles.chipText, period === p.key && styles.chipTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>
      ) : summary && breakdown && data ? (
        <>
          {data.returns.open > 0 && (
            <TouchableOpacity style={styles.notice} onPress={() => navigation.navigate("MarketplaceOrders")}>
              <Text style={styles.noticeText}>
                {data.returns.open} open return request{data.returns.open === 1 ? "" : "s"} waiting on you. Tap to review them in your orders.
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.grid}>
            <Kpi accent label="Net earnings" value={formatXaf(summary.net_earnings_xaf)} hint={periodLabel(period)} />
            <Kpi label="Gross sales" value={formatXaf(summary.gross_sales_xaf)} />
            <Kpi label="Platform fees" value={formatXaf(summary.platform_fees_xaf)} hint={`${breakdown.feePct}% of gross`} />
            <Kpi label="Held in escrow" value={formatXaf(summary.held_in_escrow_xaf)} hint="Released after delivery" />
            <Kpi label="Wallet balance" value={formatXaf(summary.wallet_balance_xaf)} />
            <Kpi label="Completed orders" value={String(summary.orders_completed)} hint={`${summary.orders_open} open · ${summary.orders_cancelled} cancelled`} />
            <Kpi label="Items sold" value={String(summary.items_sold)} />
            <Kpi label="Average order" value={formatXaf(summary.average_order_xaf)} />
            <Kpi label="Listing views" value={viewsLabel(summary.listing_views, summary.conversion_pct)} />
          </View>

          <Text style={styles.section}>Net earnings per {bucket}</Text>
          <View style={styles.panel}>
            {points.length === 0 || heights.every((h) => h === 0) ? (
              <Text style={styles.muted}>No earnings in this period yet.</Text>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chart}>
                    {points.map((point, index) => (
                      <TouchableOpacity
                        key={point.date} style={styles.barSlot} onPress={() => setSelected(selected === index ? null : index)}
                        accessibilityLabel={`${bucketLabel(point.date, bucket)}: ${formatXaf(point.net_xaf)}`}
                      >
                        <View style={styles.barArea}>
                          <View style={[styles.bar, { height: heights[index] }, selected === index && styles.barSelected]} />
                        </View>
                        <Text style={styles.barLabel} numberOfLines={1}>{index % every === 0 ? bucketLabel(point.date, bucket) : ""}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <Text style={styles.chartDetail}>
                  {picked
                    ? `${bucketLabel(picked.date, bucket)}: ${formatXaf(picked.net_xaf)} net · ${formatXaf(picked.gross_xaf)} gross · ${picked.orders} order${picked.orders === 1 ? "" : "s"}`
                    : "Tap a bar for details."}
                </Text>
              </>
            )}
          </View>

          <Text style={styles.section}>Where your money goes</Text>
          <View style={styles.panel}>
            <View style={styles.row}><Text style={styles.rowLabel}>Gross sales</Text><Text style={styles.rowValue}>{formatXaf(breakdown.gross)}</Text></View>
            <View style={styles.row}><Text style={styles.rowLabel}>Platform fees ({breakdown.feePct}%)</Text><Text style={styles.rowValue}>- {formatXaf(breakdown.fees)}</Text></View>
            <View style={styles.row}><Text style={styles.rowLabel}>Refunds</Text><Text style={styles.rowValue}>- {formatXaf(breakdown.refunds)}</Text></View>
            <View style={[styles.row, styles.rowTotal]}><Text style={styles.rowTotalLabel}>Net earnings</Text><Text style={styles.rowTotalValue}>{formatXaf(breakdown.net)}</Text></View>
          </View>

          <Text style={styles.section}>By category</Text>
          <View style={styles.panel}>
            {data.by_category.length === 0 ? <Text style={styles.muted}>No sales yet.</Text> : data.by_category.map((row) => (
              <View key={row.category} style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowLabel}>{CATEGORY_LABELS[row.category] ?? row.category}</Text>
                  <Text style={styles.muted}>{row.orders} order{row.orders === 1 ? "" : "s"} · net {formatXaf(row.net_xaf)}</Text>
                </View>
                <Text style={styles.rowValue}>{formatXaf(row.gross_xaf)}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.section}>Top listings</Text>
          <View style={styles.panel}>
            {data.top_listings.length === 0 ? <Text style={styles.muted}>Nothing sold yet.</Text> : data.top_listings.map((listing) => (
              <TouchableOpacity key={listing.listing_id} style={styles.row} onPress={() => navigation.navigate("MarketplaceListingDetail", { category: listing.category, listingId: listing.listing_id })}>
                <View style={styles.rowMain}>
                  <Text style={styles.link} numberOfLines={1}>{listing.title}</Text>
                  <Text style={styles.muted}>{CATEGORY_LABELS[listing.category] ?? listing.category} · {listing.orders} order{listing.orders === 1 ? "" : "s"}</Text>
                </View>
                <Text style={styles.rowValue}>{formatXaf(listing.gross_xaf)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionInline}>Payout history</Text>
        <TouchableOpacity style={[styles.exportButton, exporting && styles.disabled]} disabled={exporting} onPress={exportCsv}>
          {exporting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.exportText}>Export CSV</Text>}
        </TouchableOpacity>
      </View>
      {payoutError ? <Text style={styles.error}>{payoutError}</Text> : null}
      <View style={styles.panel}>
        {payouts.length === 0 && !payoutsLoading && <Text style={styles.muted}>No payouts in this period.</Text>}
        {payouts.map((payout) => (
          <View key={payout.order_id} style={styles.payout}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, styles.rowMain]} numberOfLines={1}>{payout.listing_title}</Text>
              <Text style={styles.rowTotalValue}>{formatXaf(payout.net_xaf)}</Text>
            </View>
            <Text style={styles.muted}>{payout.buyer_name} · ×{payout.quantity} · {formatDate(payout.paid_at)}</Text>
            <Text style={styles.muted}>
              Gross {formatXaf(payout.gross_xaf)} · fee {formatXaf(payout.fee_xaf)}{Number(payout.refunded_xaf) > 0 ? ` · refunded ${formatXaf(payout.refunded_xaf)}` : ""}
            </Text>
          </View>
        ))}
        {payoutsLoading && <ActivityIndicator color="#1B2A4A" style={styles.spinner} />}
        {hasMorePayouts && !payoutsLoading && (
          <TouchableOpacity onPress={loadMorePayouts}><Text style={styles.link}>Load more</Text></TouchableOpacity>
        )}
      </View>

      <TouchableOpacity onPress={() => navigation.navigate("MarketplaceOrders")}><Text style={styles.link}>Go to my orders</Text></TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, backgroundColor: "#F9FAFB" },
  centered: { alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: "#E5E7EB" },
  chipActive: { backgroundColor: "#1B2A4A" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  chipTextActive: { color: "#fff" },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  notice: { backgroundColor: "#FEF3C7", borderRadius: 10, borderWidth: 1, borderColor: "#C9A227", padding: 12, marginBottom: 12 },
  noticeText: { color: "#78350F", fontSize: 13, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  kpi: { flexBasis: "47%", flexGrow: 1, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 12 },
  kpiAccent: { borderColor: "#C9A227", backgroundColor: "#FFFBEB" },
  kpiLabel: { fontSize: 12, color: "#6B7280" },
  kpiValue: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginTop: 2 },
  kpiHint: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  section: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginTop: 16, marginBottom: 8 },
  sectionInline: { fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, marginBottom: 8 },
  panel: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 8 },
  muted: { fontSize: 12, color: "#6B7280" },
  chart: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 4 },
  barSlot: { width: BAR_WIDTH + 8, alignItems: "center" },
  barArea: { height: 120, justifyContent: "flex-end" },
  bar: { width: BAR_WIDTH, backgroundColor: "#1B2A4A", borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barSelected: { backgroundColor: "#C9A227" },
  barLabel: { fontSize: 9, color: "#6B7280", marginTop: 4, width: BAR_WIDTH + 14, textAlign: "center" },
  chartDetail: { fontSize: 12, color: "#4B5563", marginTop: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, paddingVertical: 6 },
  rowMain: { flex: 1 },
  rowLabel: { fontSize: 13, color: "#374151", fontWeight: "600" },
  rowValue: { fontSize: 13, color: "#1B2A4A", fontWeight: "700" },
  rowTotal: { borderTopWidth: 1, borderTopColor: "#E5E7EB", marginTop: 4, paddingTop: 10 },
  rowTotalLabel: { fontSize: 14, fontWeight: "700", color: "#1B2A4A" },
  rowTotalValue: { fontSize: 14, fontWeight: "700", color: "#16A34A" },
  link: { color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline", fontSize: 13 },
  payout: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  spinner: { marginVertical: 8 },
  exportButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  exportText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
});

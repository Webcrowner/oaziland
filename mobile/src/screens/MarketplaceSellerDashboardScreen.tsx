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
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceSellerDashboard">;

const CATEGORY_KEYS: Record<string, MessageKey> = {
  warehouses: "mkt.hub.catWarehouses", stores: "mkt.hub.catStores", businesses: "mkt.hub.catBusinesses", cars: "mkt.hub.catCars", goods: "mkt.hub.catGoods",
};
const CHART_HEIGHT = 120;
const BAR_WIDTH = 22;

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
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
  const { t, locale } = useI18n();
  const categoryLabel = (category: string) => (CATEGORY_KEYS[category] ? t(CATEGORY_KEYS[category]) : category);
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
      setError(dashboard.reason instanceof Error ? dashboard.reason.message : t("mkt.dash.loadFailed"));
    }
    if (firstPage.status === "fulfilled") {
      setPayouts(firstPage.value.results);
      setPayoutPage(1);
      setHasMorePayouts(!!firstPage.value.next);
    } else {
      setPayouts([]);
      setHasMorePayouts(false);
      setPayoutError(firstPage.reason instanceof Error ? firstPage.reason.message : t("mkt.dash.payoutsFailed"));
    }
    setLoading(false);
    setPayoutsLoading(false);
  }, [t]);

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
      setPayoutError(err instanceof Error ? err.message : t("mkt.dash.morePayoutsFailed"));
    } finally {
      setPayoutsLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const csv = await fetchSellerSalesCsv(period);
      await Share.share({ message: csv, title: salesCsvTitle(period, t) });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mkt.dash.exportFailed"));
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
            <Text style={[styles.chipText, period === p.key && styles.chipTextActive]}>{periodLabel(p.key, t)}</Text>
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
                {t(data.returns.open === 1 ? "mkt.dash.openReturnsOne" : "mkt.dash.openReturnsMany", { count: data.returns.open })}
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.grid}>
            <Kpi accent label={t("mkt.dash.kpiNet")} value={formatXaf(summary.net_earnings_xaf)} hint={periodLabel(period, t)} />
            <Kpi label={t("mkt.dash.kpiGross")} value={formatXaf(summary.gross_sales_xaf)} />
            <Kpi label={t("mkt.dash.kpiFees")} value={formatXaf(summary.platform_fees_xaf)} hint={t("mkt.dash.ofGross", { pct: breakdown.feePct })} />
            <Kpi label={t("mkt.dash.kpiEscrow")} value={formatXaf(summary.held_in_escrow_xaf)} hint={t("mkt.dash.releasedAfterDelivery")} />
            <Kpi label={t("mkt.dash.kpiWallet")} value={formatXaf(summary.wallet_balance_xaf)} />
            <Kpi label={t("mkt.dash.kpiCompleted")} value={String(summary.orders_completed)} hint={t("mkt.dash.openCancelled", { open: summary.orders_open, cancelled: summary.orders_cancelled })} />
            <Kpi label={t("mkt.dash.kpiItemsSold")} value={String(summary.items_sold)} />
            <Kpi label={t("mkt.dash.kpiAverage")} value={formatXaf(summary.average_order_xaf)} />
            <Kpi label={t("mkt.dash.kpiViews")} value={viewsLabel(summary.listing_views, summary.conversion_pct, t)} />
          </View>

          <Text style={styles.section}>{t(bucket === "month" ? "mkt.dash.netPerMonth" : "mkt.dash.netPerDay")}</Text>
          <View style={styles.panel}>
            {points.length === 0 || heights.every((h) => h === 0) ? (
              <Text style={styles.muted}>{t("mkt.dash.noEarnings")}</Text>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chart}>
                    {points.map((point, index) => (
                      <TouchableOpacity
                        key={point.date} style={styles.barSlot} onPress={() => setSelected(selected === index ? null : index)}
                        accessibilityLabel={`${bucketLabel(point.date, bucket, t)}: ${formatXaf(point.net_xaf)}`}
                      >
                        <View style={styles.barArea}>
                          <View style={[styles.bar, { height: heights[index] }, selected === index && styles.barSelected]} />
                        </View>
                        <Text style={styles.barLabel} numberOfLines={1}>{index % every === 0 ? bucketLabel(point.date, bucket, t) : ""}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
                <Text style={styles.chartDetail}>
                  {picked
                    ? t(picked.orders === 1 ? "mkt.dash.chartDetailOne" : "mkt.dash.chartDetailMany", { date: bucketLabel(picked.date, bucket, t), net: formatXaf(picked.net_xaf), gross: formatXaf(picked.gross_xaf), count: picked.orders })
                    : t("mkt.dash.tapBar")}
                </Text>
              </>
            )}
          </View>

          <Text style={styles.section}>{t("mkt.dash.whereMoneyGoes")}</Text>
          <View style={styles.panel}>
            <View style={styles.row}><Text style={styles.rowLabel}>{t("mkt.dash.kpiGross")}</Text><Text style={styles.rowValue}>{formatXaf(breakdown.gross)}</Text></View>
            <View style={styles.row}><Text style={styles.rowLabel}>{t("mkt.dash.feesPct", { pct: breakdown.feePct })}</Text><Text style={styles.rowValue}>- {formatXaf(breakdown.fees)}</Text></View>
            <View style={styles.row}><Text style={styles.rowLabel}>{t("mkt.dash.refunds")}</Text><Text style={styles.rowValue}>- {formatXaf(breakdown.refunds)}</Text></View>
            <View style={[styles.row, styles.rowTotal]}><Text style={styles.rowTotalLabel}>{t("mkt.dash.kpiNet")}</Text><Text style={styles.rowTotalValue}>{formatXaf(breakdown.net)}</Text></View>
          </View>

          <Text style={styles.section}>{t("mkt.dash.byCategory")}</Text>
          <View style={styles.panel}>
            {data.by_category.length === 0 ? <Text style={styles.muted}>{t("mkt.dash.noSales")}</Text> : data.by_category.map((row) => (
              <View key={row.category} style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowLabel}>{categoryLabel(row.category)}</Text>
                  <Text style={styles.muted}>{t(row.orders === 1 ? "mkt.dash.ordersNetOne" : "mkt.dash.ordersNetMany", { count: row.orders, net: formatXaf(row.net_xaf) })}</Text>
                </View>
                <Text style={styles.rowValue}>{formatXaf(row.gross_xaf)}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.section}>{t("mkt.dash.topListings")}</Text>
          <View style={styles.panel}>
            {data.top_listings.length === 0 ? <Text style={styles.muted}>{t("mkt.dash.nothingSold")}</Text> : data.top_listings.map((listing) => (
              <TouchableOpacity key={listing.listing_id} style={styles.row} onPress={() => navigation.navigate("MarketplaceListingDetail", { category: listing.category, listingId: listing.listing_id })}>
                <View style={styles.rowMain}>
                  <Text style={styles.link} numberOfLines={1}>{listing.title}</Text>
                  <Text style={styles.muted}>{categoryLabel(listing.category)} · {t(listing.orders === 1 ? "mkt.dash.ordersOne" : "mkt.dash.ordersMany", { count: listing.orders })}</Text>
                </View>
                <Text style={styles.rowValue}>{formatXaf(listing.gross_xaf)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionInline}>{t("mkt.dash.payoutHistory")}</Text>
        <TouchableOpacity style={[styles.exportButton, exporting && styles.disabled]} disabled={exporting} onPress={exportCsv}>
          {exporting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.exportText}>{t("mkt.dash.exportCsv")}</Text>}
        </TouchableOpacity>
      </View>
      {payoutError ? <Text style={styles.error}>{payoutError}</Text> : null}
      <View style={styles.panel}>
        {payouts.length === 0 && !payoutsLoading && <Text style={styles.muted}>{t("mkt.dash.noPayouts")}</Text>}
        {payouts.map((payout) => (
          <View key={payout.order_id} style={styles.payout}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, styles.rowMain]} numberOfLines={1}>{payout.listing_title}</Text>
              <Text style={styles.rowTotalValue}>{formatXaf(payout.net_xaf)}</Text>
            </View>
            <Text style={styles.muted}>{payout.buyer_name} · ×{payout.quantity} · {formatDate(payout.paid_at, locale)}</Text>
            <Text style={styles.muted}>
              {t("mkt.dash.payoutLine", { gross: formatXaf(payout.gross_xaf), fee: formatXaf(payout.fee_xaf) })}{Number(payout.refunded_xaf) > 0 ? ` · ${t("mkt.dash.refundedAmount", { amount: formatXaf(payout.refunded_xaf) })}` : ""}
            </Text>
          </View>
        ))}
        {payoutsLoading && <ActivityIndicator color="#1B2A4A" style={styles.spinner} />}
        {hasMorePayouts && !payoutsLoading && (
          <TouchableOpacity onPress={loadMorePayouts}><Text style={styles.link}>{t("mkt.dash.loadMore")}</Text></TouchableOpacity>
        )}
      </View>

      <TouchableOpacity onPress={() => navigation.navigate("MarketplaceOrders")}><Text style={styles.link}>{t("mkt.dash.goToOrders")}</Text></TouchableOpacity>
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

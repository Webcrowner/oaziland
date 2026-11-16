import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  listMyMarketplaceOffers, marketplaceOfferAction,
  type MarketplaceOffer, type MarketplaceOfferActionName, type MarketplaceOfferStatus,
} from "../lib/api";
import { counterAmountError, offerActions, offerCurrentAmount, offerStatusLabel, parseAmount, type OfferRole } from "../lib/marketplaceOffers";
import { useI18n } from "../i18n";
import type { Translate } from "../i18n/translate";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceOffers">;

const STATUS_COLORS: Record<MarketplaceOfferStatus, string> = {
  PENDING: "#C9A227", COUNTERED: "#C9A227", ACCEPTED: "#16A34A", PAID: "#16A34A", DECLINED: "#A8502E", WITHDRAWN: "#6B7280", EXPIRED: "#6B7280",
};

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function hint(offer: MarketplaceOffer, role: OfferRole, t: Translate, locale: string): string {
  const amount = offerCurrentAmount(offer).toLocaleString();
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, locale) : t("mkt.offers.theDeadline"));
  switch (offer.status) {
    case "PENDING":
      if (!offer.respond_by) return "";
      return role === "selling" ? t("mkt.offers.hintPendingSelling", { date: date(offer.respond_by) }) : t("mkt.offers.hintPendingBuying", { date: date(offer.respond_by) });
    case "COUNTERED":
      return role === "buying"
        ? t("mkt.offers.hintCounteredBuying", { amount, date: date(offer.respond_by) })
        : t("mkt.offers.hintCounteredSelling", { amount });
    case "ACCEPTED":
      return role === "buying"
        ? t("mkt.offers.hintAcceptedBuying", { amount, date: date(offer.pay_by) })
        : t("mkt.offers.hintAcceptedSelling", { amount, date: date(offer.pay_by) });
    case "PAID": return t("mkt.offers.hintPaid");
    default: return "";
  }
}

/** Offers on marketplace listings: the ones you made as a buyer and the ones you received as a seller. */
export default function MarketplaceOffersScreen({ navigation, route }: Props) {
  const { t, locale } = useI18n();
  const [role, setRole] = useState<OfferRole>(route.params?.role ?? "buying");
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [countering, setCountering] = useState<string | null>(null);
  const [counterText, setCounterText] = useState("");

  const load = useCallback(async (which: OfferRole) => {
    try {
      setOffers((await listMyMarketplaceOffers(which)).results);
      setError("");
    } catch (err) {
      setOffers([]);
      setError(err instanceof Error ? err.message : t("mkt.offers.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(role); }, [load, role]);

  // Opened from a notification that points at the other tab.
  const requestedRole = route.params?.role;
  useEffect(() => {
    if (requestedRole && requestedRole !== role) switchRole(requestedRole);
  }, [requestedRole]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(offerId: string, action: MarketplaceOfferActionName, amount?: number) {
    setError("");
    try {
      await marketplaceOfferAction(offerId, action, amount);
      setCountering(null);
      setCounterText("");
      await load(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.actionFailedBody"));
    }
  }

  function confirmThen(message: string, offerId: string, action: MarketplaceOfferActionName) {
    Alert.alert(t("mkt.offers.areYouSure"), message, [
      { text: t("mkt.offers.no"), style: "cancel" },
      { text: t("mkt.offers.yes"), onPress: () => run(offerId, action) },
    ]);
  }

  function sendCounter(offer: MarketplaceOffer) {
    const invalid = counterAmountError(counterText, Number(offer.amount_xaf), Number(offer.listing_price_xaf), t);
    if (invalid) {
      setError(invalid);
      return;
    }
    run(offer.id, "counter", parseAmount(counterText) ?? 0);
  }

  function switchRole(next: OfferRole) {
    setRole(next);
    setLoading(true);
    setError("");
    setCountering(null);
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(["buying", "selling"] as OfferRole[]).map((value) => (
          <TouchableOpacity key={value} style={[styles.tab, role === value && styles.tabActive]} onPress={() => switchRole(value)}>
            <Text style={[styles.tabText, role === value && styles.tabTextActive]}>{value === "buying" ? t("mkt.offers.tabBuying") : t("mkt.offers.tabSelling")}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>
      ) : (
        <FlatList
          data={offers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.empty}>{role === "buying" ? t("mkt.offers.emptyBuying") : t("mkt.offers.emptySelling")}</Text>
              <TouchableOpacity onPress={() => navigation.navigate("Marketplace")}><Text style={styles.link}>{t("mkt.offers.browse")}</Text></TouchableOpacity>
            </View>
          }
          renderItem={({ item: offer }) => {
            const actions = offerActions(offer.status, role);
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <TouchableOpacity style={styles.titleWrap} disabled={!offer.category} onPress={() => offer.category && navigation.navigate("MarketplaceListingDetail", { category: offer.category, listingId: offer.listing_id })}>
                    <Text style={styles.cardTitle}>{offer.listing_title}</Text>
                  </TouchableOpacity>
                  <View style={[styles.badge, { backgroundColor: STATUS_COLORS[offer.status] }]}>                  <Text style={styles.badgeText}>{offerStatusLabel(offer.status, role, t)}</Text></View>
                </View>
                <Text style={styles.meta}>
                                    {t("mkt.offers.metaAsking", { amount: Number(offer.listing_price_xaf).toLocaleString() })} · {t("mkt.offers.metaOffer", { amount: Number(offer.amount_xaf).toLocaleString() })}
                                    {offer.counter_amount_xaf ? ` · ${t("mkt.offers.metaCounter", { amount: Number(offer.counter_amount_xaf).toLocaleString() })}` : ""}
                </Text>
                                  <Text style={styles.meta}>{role === "buying" ? t("mkt.offers.seller", { name: offer.seller_name }) : t("mkt.offers.buyer", { name: offer.buyer_name })}</Text>
                {offer.message ? <Text style={styles.message}>“{offer.message}”</Text> : null}
                                  <Text style={styles.date}>{formatDate(offer.created_at, locale)}</Text>
                                  {hint(offer, role, t, locale) ? <Text style={styles.hint}>{hint(offer, role, t, locale)}</Text> : null}

                {countering === offer.id ? (
                  <View>
                                      <TextInput style={styles.input} placeholder={t("mkt.offers.counterPlaceholder")} value={counterText} onChangeText={setCounterText} keyboardType="number-pad" />
                    <View style={styles.actions}>
                      <TouchableOpacity style={[styles.primary, !counterText.trim() && styles.disabled]} disabled={!counterText.trim()} onPress={() => sendCounter(offer)}>
                                          <Text style={styles.primaryText}>{t("mkt.offers.sendCounter")}</Text>
                      </TouchableOpacity>
                                        <TouchableOpacity onPress={() => setCountering(null)}><Text style={styles.secondary}>{t("mkt.offers.close")}</Text></TouchableOpacity>
                    </View>
                  </View>
                ) : actions.length > 0 ? (
                  <View style={styles.actions}>
                    {actions.includes("accept") && (
                      <TouchableOpacity style={styles.primary} onPress={() => run(offer.id, "accept")}>
                                          <Text style={styles.primaryText}>{role === "buying" ? t("mkt.offers.acceptCounter") : t("mkt.offers.accept")}</Text>
                      </TouchableOpacity>
                    )}
                    {actions.includes("pay") && offer.category !== "" && (
                      <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("MarketplaceListingDetail", { category: offer.category as Exclude<MarketplaceOffer["category"], "">, listingId: offer.listing_id })}>
                                          <Text style={styles.primaryText}>{t("mkt.offers.payNow")}</Text>
                      </TouchableOpacity>
                    )}
                    {actions.includes("counter") && (
                                        <TouchableOpacity onPress={() => { setCountering(offer.id); setCounterText(""); setError(""); }}><Text style={styles.secondary}>{t("mkt.offers.counter")}</Text></TouchableOpacity>
                    )}
                    {actions.includes("decline") && (
                                        <TouchableOpacity onPress={() => confirmThen(t("mkt.offers.declineConfirm"), offer.id, "decline")}><Text style={styles.danger}>{t("mkt.offers.decline")}</Text></TouchableOpacity>
                    )}
                    {actions.includes("withdraw") && (
                                        <TouchableOpacity onPress={() => confirmThen(t("mkt.offers.withdrawConfirm"), offer.id, "withdraw")}><Text style={styles.danger}>{t("mkt.offers.withdraw")}</Text></TouchableOpacity>
                    )}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  centered: { alignItems: "center", justifyContent: "center", paddingTop: 40 },
  tabs: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 8 },
  tab: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, backgroundColor: "#E5E7EB" },
  tabActive: { backgroundColor: "#1B2A4A" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  tabTextActive: { color: "#fff" },
  error: { color: "#DC2626", fontSize: 13, paddingHorizontal: 16, paddingBottom: 4 },
  list: { padding: 16, paddingTop: 8 },
  empty: { color: "#6B7280", marginBottom: 8 },
  link: { color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline" },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  titleWrap: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  meta: { fontSize: 13, color: "#4B5563" },
  message: { fontSize: 13, color: "#374151", fontStyle: "italic", marginTop: 4 },
  date: { fontSize: 11, color: "#9CA3AF", marginTop: 4, marginBottom: 8 },
  hint: { fontSize: 13, color: "#4B5563", marginBottom: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  primaryText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
  secondary: { color: "#1B2A4A", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  danger: { color: "#B91C1C", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14 },
});

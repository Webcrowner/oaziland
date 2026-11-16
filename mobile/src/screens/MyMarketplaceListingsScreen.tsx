import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert, Switch } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  listMyMarketplaceListings, updateMarketplaceListing, setMarketplaceListingStatus, deleteMarketplaceListing, renewMarketplaceListing, loadListingConditions,
  type BrowsableCategory, type MarketplaceCategory, type MarketplaceAvailability, type MyMarketplaceListing,
} from "../lib/api";
import MarketplacePriceFields from "../components/MarketplacePriceFields";
import MarketplaceConditionsFields, { saveConditions } from "../components/MarketplaceConditionsFields";
import BoostListingModal from "../components/BoostListingModal";
import {
  CONDITION_TARGETS, conditionsChanged, conditionsError, conditionsFromItem, EMPTY_CONDITIONS, type ConditionsDraft,
} from "../lib/marketplaceConditions";
import { depositFor } from "../lib/marketplacePricing";
import { expiryLabel, statsLabel } from "../lib/marketplaceBoost";
import { CLEAR_SALE_PAYLOAD, countdownLabel, isOnSale, saleDraftError, saleDraftFilled, saleDraftFrom, salePayload, type SaleDraft } from "../lib/flashSale";
import { MOMENT_FORMAT_HINT } from "../lib/dateTimeInput";
import { compareAtError } from "../lib/goodsListing";
import { useI18n } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "MyMarketplaceListings">;

const CATEGORIES: { key: BrowsableCategory; label: string }[] = [
  { key: "warehouses", label: "Warehouses" },
  { key: "stores", label: "Stores" },
  { key: "businesses", label: "Businesses" },
  { key: "cars", label: "Cars" },
  { key: "goods", label: "Goods" },
];
const STATUSES: { value: MarketplaceAvailability; label: string }[] = [
  { value: "AVAILABLE", label: "Available" },
  { value: "UNDER_OFFER", label: "Under offer" },
  { value: "UNAVAILABLE", label: "Sold / unavailable" },
];

const EMPTY_ROWS: Record<BrowsableCategory, MyMarketplaceListing[]> = { warehouses: [], stores: [], businesses: [], cars: [], goods: [] };

interface Draft {
  title: string; description: string; price: string; priceBasis: string; deposit: string; quantity: string;
  sizeSqm: string; frontage: string; seating: string; revenue: string;
  goodwill: boolean; inventory: boolean;
  make: string; model: string; year: string; mileage: string; engine: string;
  sale: SaleDraft; hadSale: boolean;
  compareAt: string; hasVariants: boolean;
}

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));

function draftFrom(listing: MyMarketplaceListing): Draft {
  const spec = listing.vehicle_spec;
  return {
    title: listing.title, description: listing.description, price: String(Number(listing.price_xaf)), priceBasis: listing.price_basis,
    deposit: String(Number(listing.security_deposit_xaf ?? 0)), quantity: text(listing.quantity),
    sizeSqm: text(listing.size_sqm), frontage: text(listing.frontage_meters), seating: text(listing.seating_capacity),
    revenue: text(listing.annual_revenue_xaf), goodwill: Boolean(listing.includes_goodwill), inventory: Boolean(listing.includes_inventory),
    make: text(spec?.make), model: text(spec?.model), year: text(spec?.year), mileage: text(spec?.mileage_km), engine: text(spec?.engine_size_cc),
    sale: saleDraftFrom(listing), hadSale: Boolean(listing.sale_price_xaf),
    compareAt: listing.compare_at_price_xaf ? String(Number(listing.compare_at_price_xaf)) : "", hasVariants: Boolean(listing.has_variants),
  };
}

/** Only the fields that exist for this category; blank optional numbers are sent as null so they can be cleared. */
function payloadFrom(category: BrowsableCategory, d: Draft): Record<string, unknown> {
  // Goods are always sold, so the basis and deposit stay as they are; the rest of a goods listing is changed by reposting.
  if (category === "goods") {
    // With options, stock is the total of the versions and the server refuses a stock number; a blank original price clears it.
    const base = {
      title: d.title, description: d.description, price_xaf: d.price, compare_at_price_xaf: d.compareAt.trim() || null,
      ...(d.hasVariants ? {} : { quantity: Number(d.quantity) }),
    };
    // A blank flash sale on a listing that had one ends it; a blank one on a listing without leaves it alone.
    if (saleDraftFilled(d.sale)) return { ...base, ...salePayload(d.sale) };
    return d.hadSale ? { ...base, ...CLEAR_SALE_PAYLOAD } : base;
  }
  const payload: Record<string, unknown> = {
    title: d.title, description: d.description, price_xaf: d.price, price_basis: d.priceBasis,
    // A deposit only exists for rentals; switching a listing to a sale clears it.
    security_deposit_xaf: depositFor(d.priceBasis, d.deposit),
  };
  if (category === "warehouses") payload.size_sqm = d.sizeSqm;
  if (category === "stores") {
    payload.size_sqm = d.sizeSqm;
    payload.frontage_meters = d.frontage || null;
  }
  if (category === "businesses") {
    payload.size_sqm = d.sizeSqm || null;
    payload.seating_capacity = d.seating ? Number(d.seating) : null;
    payload.annual_revenue_xaf = d.revenue || null;
    payload.includes_goodwill = d.goodwill;
    payload.includes_inventory = d.inventory;
  }
  if (category === "cars") {
    payload.vehicle_spec = {
      make: d.make, model: d.model, year: Number(d.year),
      mileage_km: d.mileage ? Number(d.mileage) : null, engine_size_cc: d.engine ? Number(d.engine) : null,
    };
  }
  return payload;
}

/** The lister's own marketplace listings across all four categories: edit, pause or mark sold, and delete. */
export default function MyMarketplaceListingsScreen({ navigation }: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState(EMPTY_ROWS);
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ category: BrowsableCategory; id: string } | null>(null);
  const [boosting, setBoosting] = useState<{ category: BrowsableCategory; id: string; title: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conditions, setConditions] = useState<ConditionsDraft>(EMPTY_CONDITIONS);
  const [savedConditions, setSavedConditions] = useState<ConditionsDraft>(EMPTY_CONDITIONS);
  // Conditions are only saved once they have loaded: a failed load must never look like "no conditions" and wipe the real ones.
  const [conditionsState, setConditionsState] = useState<"loading" | "ready" | "failed">("loading");

  const load = useCallback(async () => {
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      setState("signedOut");
      return;
    }
    const results = await Promise.all(CATEGORIES.map((c) => listMyMarketplaceListings(c.key).catch(() => [] as MyMarketplaceListing[])));
    setRows({ warehouses: results[0], stores: results[1], businesses: results[2], cars: results[3], goods: results[4] });
    setState("ready");
  }, []);

  // Reload on return so stock changed in the options editor shows up.
  useEffect(() => {
    load();
    return navigation.addListener("focus", load);
  }, [load, navigation]);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError("");
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Please try again.");
      return false;
    }
  }

  async function loadConditions(category: MarketplaceCategory, id: string) {
    setConditionsState("loading");
    try {
      const items = await loadListingConditions(CONDITION_TARGETS[category], id);
      const loaded = conditionsFromItem(items[0]);
      setConditions(loaded);
      setSavedConditions(loaded);
      setConditionsState("ready");
    } catch {
      setConditionsState("failed");
    }
  }

  function startEdit(category: BrowsableCategory, listing: MyMarketplaceListing) {
    setEditing({ category, id: listing.id });
    setDraft(draftFrom(listing));
    setConditions(EMPTY_CONDITIONS);
    setSavedConditions(EMPTY_CONDITIONS);
    if (category !== "goods") loadConditions(category, listing.id);
  }

  async function saveEdit() {
    if (!editing || !draft) return;
    if (editing.category === "goods" && !draft.hasVariants && !(Number(draft.quantity) >= 1)) {
      setError("Enter how many are in stock (at least 1).");
      return;
    }
    if (editing.category === "goods") {
      const compareInvalid = compareAtError(draft.compareAt, draft.price);
      if (compareInvalid) {
        setError(t(compareInvalid));
        return;
      }
    }
    if (editing.category === "goods" && saleDraftFilled(draft.sale)) {
      const saleInvalid = saleDraftError(draft.sale, Number(draft.price));
      if (saleInvalid) {
        setError(saleInvalid);
        return;
      }
    }
    const conditionsToSave = editing.category !== "goods" && conditionsState === "ready" && conditionsChanged(editing.category, savedConditions, conditions);
    const invalid = conditionsToSave && editing.category !== "goods" ? conditionsError(editing.category, conditions) : "";
    if (invalid) {
      setError(invalid);
      return;
    }
    // Stay in the editor on failure so the lister can correct the rejected value.
    const saved = await run(async () => {
      await updateMarketplaceListing(editing.category, editing.id, payloadFrom(editing.category, draft));
      if (conditionsToSave && editing.category !== "goods") await saveConditions(editing.category, editing.id, conditions);
    });
    if (saved) setEditing(null);
  }

  function confirmDelete(category: BrowsableCategory, id: string) {
    Alert.alert("Delete this listing?", "To keep it but hide it, mark it unavailable instead.", [
      { text: "No", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => run(() => deleteMarketplaceListing(category, id)) },
    ]);
  }

  if (state === "loading") return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;

  if (state === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Sign in to manage your listings.</Text>
        <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("Login")}><Text style={styles.primaryText}>Sign In</Text></TouchableOpacity>
      </View>
    );
  }

  const total = CATEGORIES.reduce((sum, c) => sum + rows[c.key].length, 0);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("Marketplace")}>
        <Text style={styles.primaryText}>Post a new listing</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.dashboardLink} onPress={() => navigation.navigate("MarketplaceSellerDashboard")}>
        <Text style={styles.link}>Seller dashboard: sales, earnings and payouts</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.dashboardLink} onPress={() => navigation.navigate("MarketplaceShopSettings")}>
        <Text style={styles.link}>Shop settings: storefront, vacation mode and discount codes</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {total === 0 && <Text style={[styles.muted, styles.empty]}>You have not posted anything on the marketplace yet.</Text>}

      {CATEGORIES.filter((c) => rows[c.key].length > 0).map((c) => (
        <View key={c.key}>
          <Text style={styles.section}>{c.label}</Text>
          {rows[c.key].map((listing) => {
            const isEditing = editing?.id === listing.id;
            return (
              <View key={listing.id} style={styles.card}>
                {isEditing && draft ? (
                  <View>
                    <TextInput style={styles.input} placeholder="Title" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
                    <TextInput style={[styles.input, styles.multiline]} placeholder="Description" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} multiline numberOfLines={3} />
                    {c.key === "goods" ? (
                      <>
                        <TextInput style={styles.input} placeholder="Price (XAF)" value={draft.price} onChangeText={(price) => setDraft({ ...draft, price })} keyboardType="numeric" />
                        <TextInput style={styles.input} placeholder={t("goods.form.compareAt")} accessibilityLabel={t("goods.form.compareAt")} value={draft.compareAt} onChangeText={(compareAt) => setDraft({ ...draft, compareAt })} keyboardType="numeric" />
                        {draft.hasVariants ? (
                          <Text style={styles.stats}>{t("variants.stockFromOptions", { count: Number(listing.quantity ?? 0) })}</Text>
                        ) : (
                          <TextInput style={styles.input} placeholder="Quantity in stock" value={draft.quantity} onChangeText={(quantity) => setDraft({ ...draft, quantity })} keyboardType="number-pad" />
                        )}
                        <View style={styles.saleBox}>
                          <Text style={styles.saleTitle}>⚡ Flash sale (optional)</Text>
                          <Text style={styles.stats}>A limited-time price below the normal price, for up to 30 days. Buyers see the normal price struck through.</Text>
                          <TextInput style={styles.input} placeholder="Sale price (XAF)" value={draft.sale.price} onChangeText={(price) => setDraft({ ...draft, sale: { ...draft.sale, price } })} keyboardType="numeric" />
                          <TextInput style={styles.input} placeholder={`Starts (${MOMENT_FORMAT_HINT}, blank = now)`} value={draft.sale.startsAt} onChangeText={(startsAt) => setDraft({ ...draft, sale: { ...draft.sale, startsAt } })} autoCorrect={false} />
                          <TextInput style={styles.input} placeholder={`Ends (${MOMENT_FORMAT_HINT})`} value={draft.sale.endsAt} onChangeText={(endsAt) => setDraft({ ...draft, sale: { ...draft.sale, endsAt } })} autoCorrect={false} />
                          {saleDraftFilled(draft.sale) && (
                            <TouchableOpacity onPress={() => setDraft({ ...draft, sale: { price: "", startsAt: "", endsAt: "" } })}>
                              <Text style={styles.danger}>Clear flash sale</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </>
                    ) : (
                      <MarketplacePriceFields
                        price={draft.price} onPriceChange={(price) => setDraft({ ...draft, price })}
                        priceBasis={draft.priceBasis} onPriceBasisChange={(priceBasis) => setDraft({ ...draft, priceBasis })}
                        deposit={draft.deposit} onDepositChange={(deposit) => setDraft({ ...draft, deposit })}
                      />
                    )}
                    {c.key !== "cars" && c.key !== "goods" && <TextInput style={styles.input} placeholder="Size (m²)" value={draft.sizeSqm} onChangeText={(sizeSqm) => setDraft({ ...draft, sizeSqm })} keyboardType="numeric" />}
                    {c.key === "stores" && <TextInput style={styles.input} placeholder="Frontage (meters, optional)" value={draft.frontage} onChangeText={(frontage) => setDraft({ ...draft, frontage })} keyboardType="numeric" />}
                    {c.key === "businesses" && (
                      <>
                        <TextInput style={styles.input} placeholder="Seating capacity (optional)" value={draft.seating} onChangeText={(seating) => setDraft({ ...draft, seating })} keyboardType="numeric" />
                        <TextInput style={styles.input} placeholder="Annual revenue (XAF, optional)" value={draft.revenue} onChangeText={(revenue) => setDraft({ ...draft, revenue })} keyboardType="numeric" />
                        <View style={styles.switchRow}>
                          <Text style={styles.switchLabel}>Includes goodwill</Text>
                          <Switch value={draft.goodwill} onValueChange={(goodwill) => setDraft({ ...draft, goodwill })} />
                        </View>
                        <View style={styles.switchRow}>
                          <Text style={styles.switchLabel}>Includes inventory</Text>
                          <Switch value={draft.inventory} onValueChange={(inventory) => setDraft({ ...draft, inventory })} />
                        </View>
                      </>
                    )}
                    {c.key === "cars" && (
                      <>
                        <TextInput style={styles.input} placeholder="Make" value={draft.make} onChangeText={(make) => setDraft({ ...draft, make })} />
                        <TextInput style={styles.input} placeholder="Model" value={draft.model} onChangeText={(model) => setDraft({ ...draft, model })} />
                        <TextInput style={styles.input} placeholder="Year" value={draft.year} onChangeText={(year) => setDraft({ ...draft, year })} keyboardType="numeric" />
                        <TextInput style={styles.input} placeholder="Mileage (km, optional)" value={draft.mileage} onChangeText={(mileage) => setDraft({ ...draft, mileage })} keyboardType="numeric" />
                        <TextInput style={styles.input} placeholder="Engine size (cc, optional)" value={draft.engine} onChangeText={(engine) => setDraft({ ...draft, engine })} keyboardType="numeric" />
                      </>
                    )}
                    {c.key !== "goods" && conditionsState === "ready" && <MarketplaceConditionsFields category={c.key} value={conditions} onChange={setConditions} />}
                    {c.key !== "goods" && conditionsState === "loading" && <ActivityIndicator color="#1B2A4A" style={styles.conditionsStatus} />}
                    {c.key !== "goods" && conditionsState === "failed" && (
                      <View style={styles.conditionsStatus}>
                        <Text style={styles.error}>Conditions could not be loaded, so they will be left unchanged.</Text>
                        <TouchableOpacity onPress={() => c.key !== "goods" && loadConditions(c.key, listing.id)}><Text style={styles.link}>Try again</Text></TouchableOpacity>
                      </View>
                    )}
                    <View style={styles.actions}>
                      <TouchableOpacity style={styles.primarySmall} onPress={saveEdit}><Text style={styles.primaryText}>Save</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditing(null)}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View>
                    <TouchableOpacity onPress={() => navigation.navigate("MarketplaceListingDetail", { category: c.key, listingId: listing.id })}>
                      <Text style={styles.title}>{listing.title}</Text>
                    </TouchableOpacity>
                    <Text style={styles.price}>{Number(listing.price_xaf).toLocaleString()} XAF{c.key === "goods" && listing.quantity !== undefined ? ` · ${listing.quantity > 0 ? `${listing.quantity} in stock` : "Sold out"}` : ""}</Text>
                    {c.key === "goods" && isOnSale({ ...listing, price_xaf: listing.price_xaf }) && (
                      <Text style={styles.saleLine}>⚡ Flash sale: {Number(listing.sale_price_xaf).toLocaleString()} XAF · {countdownLabel(listing.sale_ends_at)}</Text>
                    )}
                    {listing.is_boosted && (
                      <Text style={styles.boosted}>
                        <Text style={styles.topBadge}> TOP </Text>
                        {listing.boosted_until ? `  Boosted until ${new Date(listing.boosted_until).toLocaleDateString()}` : ""}
                      </Text>
                    )}
                    {listing.stats && <Text style={styles.stats}>{statsLabel(listing.stats)}</Text>}
                    {!listing.removed_by_moderation && listing.availability_status === "AVAILABLE" && expiryLabel(listing.expires_at, listing.is_expired) ? (
                      <Text style={[styles.stats, listing.is_expired && styles.expired]}>{expiryLabel(listing.expires_at, listing.is_expired)}</Text>
                    ) : null}
                    {listing.removed_by_moderation ? (
                      <Text style={styles.error}>This listing was removed by moderation. Contact support to appeal.</Text>
                    ) : (
                      <View style={styles.chips}>
                        {STATUSES.map((s) => (
                          <TouchableOpacity
                            key={s.value}
                            style={[styles.chip, listing.availability_status === s.value && styles.chipActive]}
                            onPress={() => listing.availability_status !== s.value && run(() => setMarketplaceListingStatus(c.key, listing.id, s.value))}
                          >
                            <Text style={[styles.chipText, listing.availability_status === s.value && styles.chipTextActive]}>{s.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {c.key === "goods" && (
                      <TouchableOpacity
                        style={styles.optionsButton}
                        onPress={() => navigation.navigate("MarketplaceVariants", { listingId: listing.id, title: listing.title })}
                      >
                        <Text style={styles.optionsText}>{t("variants.entry")}</Text>
                      </TouchableOpacity>
                    )}
                    <View style={styles.actions}>
                      <TouchableOpacity onPress={() => startEdit(c.key, listing)}><Text style={styles.link}>Edit</Text></TouchableOpacity>
                      {!listing.removed_by_moderation && listing.availability_status === "AVAILABLE" && (
                        <>
                          <TouchableOpacity onPress={() => run(() => renewMarketplaceListing(c.key, listing.id))}>
                            <Text style={styles.success}>{listing.is_expired ? "Renew (expired)" : "Renew"}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setBoosting({ category: c.key, id: listing.id, title: listing.title })}>
                            <Text style={styles.link}>Boost</Text>
                          </TouchableOpacity>
                        </>
                      )}
                      <TouchableOpacity onPress={() => confirmDelete(c.key, listing.id)}><Text style={styles.danger}>Delete</Text></TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}
      <BoostListingModal target={boosting} onClose={() => setBoosting(null)} onBoosted={load} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  muted: { color: "#6B7280", fontSize: 14, textAlign: "center", marginBottom: 12 },
  empty: { marginTop: 24 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", marginBottom: 12 },
  dashboardLink: { alignItems: "center", marginBottom: 12 },
  primarySmall: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16 },
  primaryText: { color: "#1B2A4A", fontWeight: "700" },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  section: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginTop: 12, marginBottom: 8 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 10 },
  title: { fontWeight: "700", color: "#1B2A4A", fontSize: 15 },
  price: { fontSize: 13, color: "#4B5563", marginTop: 2, marginBottom: 4 },
  stats: { fontSize: 12, color: "#6B7280", marginBottom: 4 },
  saleBox: { backgroundColor: "#FFF7ED", borderColor: "#FDBA74", borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  saleTitle: { fontSize: 13, fontWeight: "700", color: "#9A3412", marginBottom: 4 },
  saleLine: { fontSize: 12, fontWeight: "700", color: "#B91C1C", marginBottom: 4 },
  expired: { color: "#B91C1C", fontWeight: "700" },
  boosted: { fontSize: 12, color: "#4B5563", marginBottom: 6 },
  topBadge: { backgroundColor: "#C9A227", color: "#1B2A4A", fontWeight: "700", fontSize: 11 },
  success: { color: "#15803D", fontWeight: "600", textDecorationLine: "underline", fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipActive: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipText: { fontSize: 12, color: "#374151" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", gap: 18 },
  link: { color: "#1B2A4A", fontWeight: "600", textDecorationLine: "underline", fontSize: 13 },
  danger: { color: "#B91C1C", fontWeight: "600", textDecorationLine: "underline", fontSize: 13 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14 },
  multiline: { textAlignVertical: "top", minHeight: 70 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  switchLabel: { fontSize: 14, color: "#374151" },
  conditionsStatus: { marginBottom: 12 },
  optionsButton: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingHorizontal: 12, marginBottom: 8 },
  optionsText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
});

import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert, Switch } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  listMyMarketplaceListings, updateMarketplaceListing, setMarketplaceListingStatus, deleteMarketplaceListing, loadListingConditions,
  type MarketplaceCategory, type MarketplaceAvailability, type MyMarketplaceListing,
} from "../lib/api";
import MarketplacePriceFields from "../components/MarketplacePriceFields";
import MarketplaceConditionsFields, { saveConditions } from "../components/MarketplaceConditionsFields";
import {
  CONDITION_TARGETS, conditionsChanged, conditionsError, conditionsFromItem, EMPTY_CONDITIONS, type ConditionsDraft,
} from "../lib/marketplaceConditions";
import { depositFor } from "../lib/marketplacePricing";

type Props = NativeStackScreenProps<RootStackParamList, "MyMarketplaceListings">;

const CATEGORIES: { key: MarketplaceCategory; label: string }[] = [
  { key: "warehouses", label: "Warehouses" },
  { key: "stores", label: "Stores" },
  { key: "businesses", label: "Businesses" },
  { key: "cars", label: "Cars" },
];
const STATUSES: { value: MarketplaceAvailability; label: string }[] = [
  { value: "AVAILABLE", label: "Available" },
  { value: "UNDER_OFFER", label: "Under offer" },
  { value: "UNAVAILABLE", label: "Sold / unavailable" },
];

const EMPTY_ROWS: Record<MarketplaceCategory, MyMarketplaceListing[]> = { warehouses: [], stores: [], businesses: [], cars: [] };

interface Draft {
  title: string; description: string; price: string; priceBasis: string; deposit: string;
  sizeSqm: string; frontage: string; seating: string; revenue: string;
  goodwill: boolean; inventory: boolean;
  make: string; model: string; year: string; mileage: string; engine: string;
}

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));

function draftFrom(listing: MyMarketplaceListing): Draft {
  const spec = listing.vehicle_spec;
  return {
    title: listing.title, description: listing.description, price: String(Number(listing.price_xaf)), priceBasis: listing.price_basis,
    deposit: String(Number(listing.security_deposit_xaf ?? 0)),
    sizeSqm: text(listing.size_sqm), frontage: text(listing.frontage_meters), seating: text(listing.seating_capacity),
    revenue: text(listing.annual_revenue_xaf), goodwill: Boolean(listing.includes_goodwill), inventory: Boolean(listing.includes_inventory),
    make: text(spec?.make), model: text(spec?.model), year: text(spec?.year), mileage: text(spec?.mileage_km), engine: text(spec?.engine_size_cc),
  };
}

/** Only the fields that exist for this category; blank optional numbers are sent as null so they can be cleared. */
function payloadFrom(category: MarketplaceCategory, d: Draft): Record<string, unknown> {
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
  const [rows, setRows] = useState(EMPTY_ROWS);
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ category: MarketplaceCategory; id: string } | null>(null);
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
    setRows({ warehouses: results[0], stores: results[1], businesses: results[2], cars: results[3] });
    setState("ready");
  }, []);

  useEffect(() => { load(); }, [load]);

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

  function startEdit(category: MarketplaceCategory, listing: MyMarketplaceListing) {
    setEditing({ category, id: listing.id });
    setDraft(draftFrom(listing));
    setConditions(EMPTY_CONDITIONS);
    setSavedConditions(EMPTY_CONDITIONS);
    loadConditions(category, listing.id);
  }

  async function saveEdit() {
    if (!editing || !draft) return;
    const conditionsToSave = conditionsState === "ready" && conditionsChanged(editing.category, savedConditions, conditions);
    const invalid = conditionsToSave ? conditionsError(editing.category, conditions) : "";
    if (invalid) {
      setError(invalid);
      return;
    }
    // Stay in the editor on failure so the lister can correct the rejected value.
    const saved = await run(async () => {
      await updateMarketplaceListing(editing.category, editing.id, payloadFrom(editing.category, draft));
      if (conditionsToSave) await saveConditions(editing.category, editing.id, conditions);
    });
    if (saved) setEditing(null);
  }

  function confirmDelete(category: MarketplaceCategory, id: string) {
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
                    <MarketplacePriceFields
                      price={draft.price} onPriceChange={(price) => setDraft({ ...draft, price })}
                      priceBasis={draft.priceBasis} onPriceBasisChange={(priceBasis) => setDraft({ ...draft, priceBasis })}
                      deposit={draft.deposit} onDepositChange={(deposit) => setDraft({ ...draft, deposit })}
                    />
                    {c.key !== "cars" && <TextInput style={styles.input} placeholder="Size (m²)" value={draft.sizeSqm} onChangeText={(sizeSqm) => setDraft({ ...draft, sizeSqm })} keyboardType="numeric" />}
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
                    {conditionsState === "ready" && <MarketplaceConditionsFields category={c.key} value={conditions} onChange={setConditions} />}
                    {conditionsState === "loading" && <ActivityIndicator color="#1B2A4A" style={styles.conditionsStatus} />}
                    {conditionsState === "failed" && (
                      <View style={styles.conditionsStatus}>
                        <Text style={styles.error}>Conditions could not be loaded, so they will be left unchanged.</Text>
                        <TouchableOpacity onPress={() => loadConditions(c.key, listing.id)}><Text style={styles.link}>Try again</Text></TouchableOpacity>
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
                    <Text style={styles.price}>{Number(listing.price_xaf).toLocaleString()} XAF</Text>
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
                    <View style={styles.actions}>
                      <TouchableOpacity onPress={() => startEdit(c.key, listing)}><Text style={styles.link}>Edit</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => confirmDelete(c.key, listing.id)}><Text style={styles.danger}>Delete</Text></TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  muted: { color: "#6B7280", fontSize: 14, textAlign: "center", marginBottom: 12 },
  empty: { marginTop: 24 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", marginBottom: 12 },
  primarySmall: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16 },
  primaryText: { color: "#1B2A4A", fontWeight: "700" },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  section: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginTop: 12, marginBottom: 8 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 10 },
  title: { fontWeight: "700", color: "#1B2A4A", fontSize: 15 },
  price: { fontSize: 13, color: "#4B5563", marginTop: 2, marginBottom: 8 },
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
});

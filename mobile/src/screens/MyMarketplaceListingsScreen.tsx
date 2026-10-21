import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  listMyMarketplaceListings, updateMarketplaceListing, setMarketplaceListingStatus, deleteMarketplaceListing,
  type MarketplaceCategory, type MarketplaceAvailability, type MyMarketplaceListing,
} from "../lib/api";

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

/** The lister's own marketplace listings across all four categories: edit, pause or mark sold, and delete. */
export default function MyMarketplaceListingsScreen({ navigation }: Props) {
  const [rows, setRows] = useState(EMPTY_ROWS);
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ category: MarketplaceCategory; id: string } | null>(null);
  const [draft, setDraft] = useState({ title: "", price: "", description: "" });

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

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Please try again.");
    }
  }

  function startEdit(category: MarketplaceCategory, listing: MyMarketplaceListing) {
    setEditing({ category, id: listing.id });
    setDraft({ title: listing.title, price: String(Number(listing.price_xaf)), description: listing.description });
  }

  async function saveEdit() {
    if (!editing) return;
    await run(() => updateMarketplaceListing(editing.category, editing.id, { title: draft.title, price_xaf: draft.price, description: draft.description }));
    setEditing(null);
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
                {isEditing ? (
                  <View>
                    <TextInput style={styles.input} placeholder="Title" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
                    <TextInput style={styles.input} placeholder="Price (XAF)" value={draft.price} onChangeText={(price) => setDraft({ ...draft, price })} keyboardType="numeric" />
                    <TextInput style={[styles.input, styles.multiline]} placeholder="Description" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} multiline numberOfLines={3} />
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
});

import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Image, Alert, useWindowDimensions } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  getMarketplaceListing, getMyUserId, getMyFavorites, toggleFavoriteListing, placeMarketplaceOrder, getOrCreateConversation, getListingConditions,
  type ListingConditionItem,
  type WarehouseListing, type StoreListing, type BusinessListing, type CarListing,
} from "../lib/api";
import { PRICE_BASIS_LABELS } from "../lib/marketplaceFilters";
import { CONDITION_TARGETS } from "../lib/marketplaceConditions";
import RateAndReport from "../components/RateAndReport";
import ReportListingButton from "../components/ReportListingButton";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceListingDetail">;
type AnyListing = WarehouseListing & Partial<StoreListing> & Partial<BusinessListing> & Partial<CarListing>;
type Viewer = "loading" | "signedOut" | "owner" | "buyer";

const CONDITION_FLAGS: [string, string][] = [
  ["deposit_required", "A security deposit is required"],
  ["insurance_required", "Insurance is required"],
  ["driver_required", "A driver is required"],
  ["no_subletting", "No subletting"],
  ["viewing_appointment_only", "Viewing by appointment only"],
];

/** The terms a lister set, in the order a buyer should read them. */
function conditionLines(items: ListingConditionItem[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const c = item.structured_conditions;
    if (typeof c.min_lease_months === "number") lines.push(`Minimum lease: ${c.min_lease_months} months`);
    if (typeof c.mileage_cap_km === "number") lines.push(`Mileage cap: ${c.mileage_cap_km.toLocaleString()} km`);
    for (const [key, label] of CONDITION_FLAGS) if (c[key] === true) lines.push(label);
    if (item.free_text_clause) lines.push(item.free_text_clause);
  }
  return lines;
}

/** One marketplace listing: photos, details, save, buy or rent into escrow, and report. */
export default function MarketplaceListingDetailScreen({ route, navigation }: Props) {
  const { category, listingId } = route.params;
  const { width } = useWindowDimensions();
  const [listing, setListing] = useState<AnyListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<Viewer>("loading");
  const [isFavorited, setIsFavorited] = useState(false);
  const [phone, setPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [placed, setPlaced] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);

  useEffect(() => {
    getListingConditions(CONDITION_TARGETS[category], listingId).then((items) => setConditions(conditionLines(items))).catch(() => {});
  }, [category, listingId]);

  const loadListing = useCallback(() => {
    getMarketplaceListing<AnyListing>(category, listingId)
      .then(setListing)
      .catch(() => setListing(null))
      .finally(() => setLoading(false));
  }, [category, listingId]);

  useEffect(() => { loadListing(); }, [loadListing]);

  useEffect(() => {
    SecureStore.getItemAsync("access_token").then((token) => {
      if (!token) {
        setViewer("signedOut");
        return;
      }
      getMyFavorites().then((data) => setIsFavorited(data.listing_ids.includes(listingId))).catch(() => {});
    });
  }, [listingId]);

  useEffect(() => {
    if (!listing) return;
    SecureStore.getItemAsync("access_token").then(async (token) => {
      if (!token) return;
      try {
        setViewer((await getMyUserId()) === listing.lister_user ? "owner" : "buyer");
      } catch {
        setViewer("signedOut");
      }
    });
  }, [listing]);

  async function handleToggleFavorite() {
    if (viewer === "signedOut") {
      navigation.navigate("Login");
      return;
    }
    try {
      setIsFavorited((await toggleFavoriteListing(listingId)).is_favorited);
    } catch {
      Alert.alert("Could not save", "Please try again.");
    }
  }

  async function handlePay() {
    if (!listing) return;
    setPaying(true);
    setPayError("");
    try {
      await placeMarketplaceOrder(category, listing.id, phone.trim());
      setPlaced(true);
      loadListing();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Could not place the order. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  async function handleChat() {
    if (!listing) return;
    if (viewer === "signedOut") {
      navigation.navigate("Login");
      return;
    }
    setOpeningChat(true);
    setChatError("");
    try {
      const conversation = await getOrCreateConversation(listing.lister_user);
      navigation.navigate("Conversation", {
        conversationId: conversation.id,
        participantNames: listing.lister_name || "Seller",
      });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Could not open the conversation.");
    } finally {
      setOpeningChat(false);
    }
  }

  if (loading) return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  if (!listing) return <View style={styles.centered}><Text>This listing could not be found.</Text></View>;

  const isSale = listing.price_basis === "SALE";
  const price = Number(listing.price_xaf).toLocaleString();
  const depositValue = Number(listing.security_deposit_xaf ?? 0);
  // The buyer is charged the price plus any refundable rental deposit in a single payment.
  const payTotal = (Number(listing.price_xaf) + depositValue).toLocaleString();
  const facts: string[] = [];
  if (listing.size_sqm) facts.push(`${listing.size_sqm} m²`);
  if (listing.frontage_meters) facts.push(`Frontage ${listing.frontage_meters} m`);
  if (listing.vehicle_spec) {
    const v = listing.vehicle_spec;
    facts.push(`${v.year} ${v.make} ${v.model}`);
    if (v.mileage_km) facts.push(`${v.mileage_km.toLocaleString()} km`);
  }
  if (listing.includes_goodwill) facts.push("Includes goodwill");
  if (listing.includes_inventory) facts.push("Includes inventory");
  if (listing.annual_revenue_xaf) facts.push(`Annual revenue ${Number(listing.annual_revenue_xaf).toLocaleString()} XAF`);
  const photos = listing.media.filter((m) => m.media_type === "PHOTO");

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      {photos.length > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {photos.map((p) => <Image key={p.id} source={{ uri: p.file_url }} style={[styles.photo, { width }]} />)}
        </ScrollView>
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]}><Text style={styles.photoPlaceholderText}>No photo yet</Text></View>
      )}

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{listing.title}</Text>
          <TouchableOpacity onPress={handleToggleFavorite} accessibilityLabel={isFavorited ? "Remove from saved" : "Save listing"}>
            <Text style={styles.star}>{isFavorited ? "★" : "☆"}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.price}>{price} XAF · {PRICE_BASIS_LABELS[listing.price_basis] ?? listing.price_basis}</Text>
        {listing.quarter_name ? <Text style={styles.meta}>📍 {listing.quarter_name}</Text> : null}
        {listing.availability_status === "UNDER_OFFER" && <Text style={styles.notice}>This listing is under offer.</Text>}
        {facts.length > 0 && <View style={styles.factsRow}>{facts.map((f) => <Text key={f} style={styles.fact}>{f}</Text>)}</View>}
        {listing.description ? <Text style={styles.description}>{listing.description}</Text> : null}
        {conditions.length > 0 || depositValue > 0 ? (
          <View style={styles.conditions}>
            <Text style={styles.boxTitle}>Conditions & rules</Text>
            {depositValue > 0 && (
              <Text style={styles.conditionLine}>
                • Refundable security deposit: {depositValue.toLocaleString()} XAF. Paid with the rent and held in escrow; the seller returns it when the rental comes back in good order, or it returns to you automatically a few days after the rental ends.
              </Text>
            )}
            {conditions.map((line) => <Text key={line} style={styles.conditionLine}>• {line}</Text>)}
          </View>
        ) : null}

        {viewer === "loading" ? null : viewer === "owner" ? (
          <View style={styles.box}><Text style={styles.boxText}>This is your listing.</Text></View>
        ) : placed ? (
          <View style={[styles.box, styles.boxSuccess]}>
            <Text style={styles.boxTitle}>Payment request sent</Text>
            <Text style={styles.boxText}>Approve the Mobile Money prompt. Your order will update after the payment provider confirms it.</Text>
            <TouchableOpacity onPress={() => navigation.navigate("MarketplaceOrders")}><Text style={styles.link}>View my orders</Text></TouchableOpacity>
          </View>
        ) : listing.availability_status !== "AVAILABLE" ? (
          <View style={styles.box}><Text style={styles.boxText}>This listing is not available right now.</Text></View>
        ) : (
          <View style={styles.buyBox}>
            <Text style={styles.boxTitle}>{isSale ? "Buy this listing" : "Rent this listing"}</Text>
            <Text style={styles.boxText}>Your payment is held safely in escrow. The seller is only paid after you confirm you received what you paid for.</Text>
            {viewer === "signedOut" ? (
              <TouchableOpacity style={styles.payButton} onPress={() => navigation.navigate("Login")}>
                <Text style={styles.payButtonText}>Sign in to buy</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TextInput style={styles.input} placeholder="Mobile money phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
                {payError ? <Text style={styles.error}>{payError}</Text> : null}
                <TouchableOpacity style={[styles.payButton, (paying || !phone.trim()) && styles.payButtonDisabled]} onPress={handlePay} disabled={paying || !phone.trim()}>
                  {paying ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.payButtonText}>Pay {payTotal} XAF</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {viewer !== "owner" && viewer !== "loading" && (
          <>
            <TouchableOpacity style={styles.chatButton} onPress={handleChat} disabled={openingChat}>
              {openingChat ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.chatButtonText}>Chat with seller</Text>}
            </TouchableOpacity>
            {chatError ? <Text style={styles.error}>{chatError}</Text> : null}
            <ReportListingButton listingId={listing.id} />
          </>
        )}

        <View style={styles.lister}>
          <Text style={styles.listerLabel}>Listed by {listing.lister_name}</Text>
          {viewer !== "owner" && viewer !== "loading" && viewer !== "signedOut" && <RateAndReport subjectUserId={listing.lister_user} />}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  photo: { height: 240 },
  photoPlaceholder: { backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center", width: "100%" },
  photoPlaceholderText: { color: "#4B5563" },
  body: { padding: 16 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: "700", color: "#1B2A4A" },
  star: { fontSize: 28, color: "#C9A227" },
  price: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginTop: 4 },
  meta: { fontSize: 13, color: "#6B7280", marginTop: 4 },
  notice: { fontSize: 13, color: "#A8502E", marginTop: 6 },
  factsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  fact: { fontSize: 12, color: "#374151", backgroundColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden" },
  description: { fontSize: 14, color: "#374151", marginTop: 12, lineHeight: 20 },
  conditions: { backgroundColor: "#F3F4F6", borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  conditionLine: { fontSize: 13, color: "#374151", marginTop: 4, lineHeight: 18 },
  box: { backgroundColor: "#F3F4F6", borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  boxSuccess: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  buyBox: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#C9A227" },
  boxTitle: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  boxText: { fontSize: 12, color: "#4B5563", marginBottom: 8 },
  link: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", textDecorationLine: "underline" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 8, fontSize: 14 },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  payButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  payButtonDisabled: { opacity: 0.5 },
  payButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 15 },
  chatButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 16, marginBottom: 8 },
  chatButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  lister: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  listerLabel: { fontSize: 13, color: "#6B7280" },
});

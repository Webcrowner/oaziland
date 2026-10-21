import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Image, ActivityIndicator, Modal, ScrollView, Switch } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import {
  createMarketplaceListing, addMarketplaceMedia, uploadMediaFile,
  type BusinessListing, type MediaUploadResult,
} from "../lib/api";
import { useMarketplaceListings } from "../lib/useMarketplaceListings";
import LoadMoreButton from "../components/LoadMoreButton";
import type { RootStackParamList } from "../navigation/AppNavigator";
import MarketplaceFilterBar from "../components/MarketplaceFilterBar";
import { EMPTY_MARKETPLACE_FILTERS, filtersActive, filtersToQuery, type MarketplaceFilters } from "../lib/marketplaceFilters";

/** Businesses — mobile parity with the web app's /marketplace/businesses page. */
export default function BusinessesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [filters, setFilters] = useState<MarketplaceFilters>(EMPTY_MARKETPLACE_FILTERS);
  const { items: listings, loading, hasMore, loadingMore, loadMore, reload } = useMarketplaceListings<BusinessListing>("businesses", filtersToQuery(filters));
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [includesGoodwill, setIncludesGoodwill] = useState(false);
  const [includesInventory, setIncludesInventory] = useState(false);
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingMedia(true);
    try {
      const asset = result.assets[0];
      const mimeType = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
      const uploaded = await uploadMediaFile(asset.uri, mimeType, "marketplace");
      setMedia((prev) => [...prev, uploaded]);
    } catch {
      setError("Could not upload that file. Please try again.");
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      const listing = await createMarketplaceListing("businesses", {
        title, price_basis: "SALE", price_xaf: price, includes_goodwill: includesGoodwill, includes_inventory: includesInventory,
      });
      await Promise.all(media.map((m) => addMarketplaceMedia("businesses", listing.id, m.url, m.media_type)));
      setShowForm(false);
      setTitle(""); setPrice(""); setIncludesGoodwill(false); setIncludesInventory(false); setMedia([]);
      reload();
    } catch {
      setError("Could not create listing. Please check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={listings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <TouchableOpacity style={styles.listButton} onPress={() => setShowForm(true)}>
              <Text style={styles.listButtonText}>List a Business</Text>
            </TouchableOpacity>
            <MarketplaceFilterBar value={filters} onChange={setFilters} showPriceBasis={false} />
          </View>
        }
        ListFooterComponent={hasMore ? <LoadMoreButton onPress={loadMore} loading={loadingMore} /> : null}
        ListEmptyComponent={<Text style={styles.empty}>{filtersActive(filters) ? "No listings match your filters." : "No businesses listed yet."}</Text>}
        renderItem={({ item }) => {
          const photo = item.media.find((m) => m.media_type === "PHOTO");
          return (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("MarketplaceListingDetail", { category: "businesses", listingId: item.id })}>
              {photo ? <Image source={{ uri: photo.file_url }} style={styles.cardImage} /> : (
                <View style={styles.imagePlaceholder}><Text style={styles.imagePlaceholderText}>No photo yet</Text></View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <View style={styles.badgeRow}>
                  {item.includes_goodwill && <Text style={styles.badge}>Goodwill</Text>}
                  {item.includes_inventory && <Text style={styles.badge}>Inventory</Text>}
                </View>
                <Text style={styles.price}>{Number(item.price_xaf).toLocaleString()} XAF</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <ScrollView contentContainerStyle={styles.formContainer}>
          <Text style={styles.formTitle}>List a Business</Text>
          <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} />
          <TextInput style={styles.input} placeholder="Asking Price (XAF)" value={price} onChangeText={setPrice} keyboardType="numeric" />

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Includes Goodwill</Text>
            <Switch value={includesGoodwill} onValueChange={setIncludesGoodwill} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Includes Inventory</Text>
            <Switch value={includesInventory} onValueChange={setIncludesInventory} />
          </View>

          <TouchableOpacity style={styles.photoButton} onPress={handlePickPhoto} disabled={uploadingMedia}>
            {uploadingMedia ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.photoButtonText}>Add Photo or Video</Text>}
          </TouchableOpacity>
          {media.length > 0 && <Text style={styles.mediaCount}>{media.length} file(s) attached</Text>}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>Submit Listing</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowForm(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  listButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 16 },
  listButtonText: { color: "#1B2A4A", fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 10, marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  cardImage: { height: 140, width: "100%" },
  imagePlaceholder: { height: 140, backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  imagePlaceholderText: { color: "#4B5563" },
  cardBody: { padding: 12 },
  cardTitle: { fontWeight: "700", color: "#1B2A4A", marginBottom: 6 },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
  badge: { fontSize: 11, backgroundColor: "#DCFCE7", color: "#166534", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, fontWeight: "600" },
  price: { fontSize: 16, fontWeight: "700", color: "#1B2A4A" },
  formContainer: { padding: 20 },
  formTitle: { fontSize: 20, fontWeight: "700", color: "#1B2A4A", marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 14 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  switchLabel: { fontSize: 14, color: "#374151" },
  photoButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 8 },
  photoButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  mediaCount: { fontSize: 12, color: "#6B7280", marginBottom: 12 },
  errorText: { color: "#DC2626", fontSize: 13, marginBottom: 12 },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
  submitButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 16 },
  cancelText: { textAlign: "center", color: "#6B7280" },
});

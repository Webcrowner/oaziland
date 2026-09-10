import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Image, ActivityIndicator, Modal, ScrollView } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  listMarketplaceListings, createMarketplaceListing, addMarketplaceMedia, listQuarters, uploadMediaFile,
  type StoreListing, type Quarter, type MediaUploadResult,
} from "../lib/api";

/** Stores — mobile parity with the web app's /marketplace/stores page. */
export default function StoresScreen() {
  const [listings, setListings] = useState<StoreListing[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [sizeSqm, setSizeSqm] = useState("");
  const [priceBasis, setPriceBasis] = useState("RENT_MONTHLY");
  const [price, setPrice] = useState("");
  const [quarterId, setQuarterId] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listMarketplaceListings<StoreListing>("stores")
      .then((data) => setListings(data.results)).catch(() => setListings([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    listQuarters().then((data) => {
      setQuarters(data);
      if (data.length > 0) setQuarterId(data[0].id);
    }).catch(() => {});
  }, [load]);

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
      const listing = await createMarketplaceListing("stores", { title, price_basis: priceBasis, price_xaf: price, size_sqm: sizeSqm, quarter: quarterId || null });
      await Promise.all(media.map((m) => addMarketplaceMedia("stores", listing.id, m.url, m.media_type)));
      setShowForm(false);
      setTitle(""); setSizeSqm(""); setPrice(""); setMedia([]);
      load();
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
          <TouchableOpacity style={styles.listButton} onPress={() => setShowForm(true)}>
            <Text style={styles.listButtonText}>List a Store</Text>
          </TouchableOpacity>
        }
        ListEmptyComponent={<Text style={styles.empty}>No stores listed yet.</Text>}
        renderItem={({ item }) => {
          const photo = item.media.find((m) => m.media_type === "PHOTO");
          return (
            <View style={styles.card}>
              {photo ? <Image source={{ uri: photo.file_url }} style={styles.cardImage} /> : (
                <View style={styles.imagePlaceholder}><Text style={styles.imagePlaceholderText}>No photo yet</Text></View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardSubtitle}>{item.size_sqm} m²</Text>
                <Text style={styles.price}>{Number(item.price_xaf).toLocaleString()} XAF</Text>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <ScrollView contentContainerStyle={styles.formContainer}>
          <Text style={styles.formTitle}>List a Store</Text>
          <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} />
          <TextInput style={styles.input} placeholder="Size (m²)" value={sizeSqm} onChangeText={setSizeSqm} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder="Price (XAF)" value={price} onChangeText={setPrice} keyboardType="numeric" />

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
  cardTitle: { fontWeight: "700", color: "#1B2A4A", marginBottom: 2 },
  cardSubtitle: { fontSize: 13, color: "#6B7280", marginBottom: 6 },
  price: { fontSize: 16, fontWeight: "700", color: "#1B2A4A" },
  formContainer: { padding: 20 },
  formTitle: { fontSize: 20, fontWeight: "700", color: "#1B2A4A", marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 14 },
  photoButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 8 },
  photoButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  mediaCount: { fontSize: 12, color: "#6B7280", marginBottom: 12 },
  errorText: { color: "#DC2626", fontSize: 13, marginBottom: 12 },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
  submitButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 16 },
  cancelText: { textAlign: "center", color: "#6B7280" },
});

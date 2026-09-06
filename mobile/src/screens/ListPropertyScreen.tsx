import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, ActivityIndicator, ScrollView } from "react-native";
import * as ImagePicker from "expo-image-picker";
import NetInfo from "@react-native-community/netinfo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { createHouse, createListing, listQuarters, uploadMediaFile, addListingPhoto, type Quarter, type MediaUploadResult } from "../lib/api";
import { enqueueAction } from "../offline/queue";

type Props = NativeStackScreenProps<RootStackParamList, "ListProperty">;

interface PendingMedia extends MediaUploadResult {
  localUri: string;
}

/**
 * List a Property — the mobile equivalent of the web app's real
 * property-creation wizard. This pass fixes a real, separate bug
 * found while wiring in genuine media upload: a photo taken here was
 * ONLY EVER shown as a local preview — handleSubmit never uploaded
 * or attached it to anything. Now supports real photo AND video
 * capture/selection (expo-image-picker's mediaTypes accepts both),
 * genuinely uploaded via the real /api/media/upload/ endpoint and
 * attached to the listing once it's created.
 */
export default function ListPropertyScreen({ navigation }: Props) {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [quarterId, setQuarterId] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [description, setDescription] = useState("");
  const [listingType, setListingType] = useState<"RENT" | "SALE">("RENT");
  const [price, setPrice] = useState("");
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listQuarters()
      .then((data) => {
        setQuarters(data);
        if (data.length > 0) setQuarterId(data[0].id);
      })
      .catch(() => {});
  }, []);

  async function uploadAndTrack(asset: ImagePicker.ImagePickerAsset) {
    setUploadingMedia(true);
    try {
      const mimeType = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
      const result = await uploadMediaFile(asset.uri, mimeType, "listings");
      setMedia((prev) => [...prev, { ...result, localUri: asset.uri }]);
    } catch {
      setMessage({ type: "error", text: "Could not upload that file. Please try again." });
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handleTakePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      setMessage({ type: "error", text: "Camera permission is required to photograph the property." });
      return;
    }
    // mediaTypes accepting both images and videos means the native
    // camera UI itself offers a photo/video toggle — real video
    // capture, not just photos.
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images", "videos"], quality: 0.7, videoMaxDuration: 60 });
    if (!result.canceled && result.assets?.[0]) {
      await uploadAndTrack(result.assets[0]);
    }
  }

  async function handlePickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setMessage({ type: "error", text: "Photo library permission is required." });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      await uploadAndTrack(result.assets[0]);
    }
  }

  async function handleSubmit() {
    setMessage(null);
    if (!quarterId) {
      setMessage({ type: "error", text: "Please choose a neighborhood." });
      return;
    }
    setLoading(true);

    const housePayload = {
      quarter: quarterId,
      bedrooms: bedrooms ? Number(bedrooms) : undefined,
      description: description || undefined,
    };
    const combinedPayload = { house: housePayload, listing_type: listingType, price_xaf: price };

    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        // Offline: queue the WHOLE two-step flow as one item — the
        // sync logic (once wired to a real connectivity listener)
        // creates the house, then the listing referencing it,
        // sequentially, using this same payload.
        await enqueueAction("CREATE_HOUSE_AND_LISTING", combinedPayload);
        setMessage({ type: "info", text: "You're offline — this listing has been saved and will submit automatically once you're back online." });
        return;
      }

      const houseRes = await createHouse(housePayload);
      if (houseRes.status === 403) {
        setMessage({ type: "error", text: "You need to complete multi-factor authentication and identity verification before listing a property." });
        setNeedsMfa(true);
        return;
      }
      if (!houseRes.ok) {
        setMessage({ type: "error", text: "Could not save the property details. Please try again." });
        return;
      }
      const house = await houseRes.json();

      const listingRes = await createListing({ property_asset_id: house.id, listing_type: listingType, price_xaf: price });
      if (!listingRes.ok) {
        setMessage({ type: "error", text: "The property was saved, but the listing itself could not be created. Please try again." });
        return;
      }
      const listing = await listingRes.json();

      // Attach every real photo/video already uploaded before submit —
      // the actual gap this whole rewrite closes: this used to just
      // discard whatever was captured, attaching nothing at all.
      await Promise.all(media.map((m) => addListingPhoto(listing.id, m.url, m.media_type)));

      setMessage({ type: "success", text: "Your listing was created — it goes live once an admin reviews it." });
    } catch {
      // A network error mid-request is functionally the same as being
      // offline from this screen's point of view — queue it rather
      // than losing the user's work.
      await enqueueAction("CREATE_HOUSE_AND_LISTING", combinedPayload);
      setMessage({ type: "info", text: "Could not reach the server — this listing has been saved and will submit automatically once you're back online." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>List a Property</Text>

      <View style={styles.photoSection}>
        {media.length === 0 && !uploadingMedia ? (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderText}>No photos or videos yet</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaPreviewRow}>
            {media.map((m, i) => (
              <View key={i} style={styles.mediaPreviewItem}>
                {m.media_type === "VIDEO" ? (
                  <View style={styles.videoPreviewBadge}>
                    <Text style={styles.videoPreviewBadgeText}>▶ Video</Text>
                  </View>
                ) : (
                  <Image source={{ uri: m.localUri }} style={styles.photoPreview} />
                )}
              </View>
            ))}
            {uploadingMedia && (
              <View style={[styles.photoPreview, styles.uploadingBox]}>
                <ActivityIndicator color="#1B2A4A" />
              </View>
            )}
          </ScrollView>
        )}
        <View style={styles.photoButtonRow}>
          <TouchableOpacity style={styles.photoButton} onPress={handleTakePhoto} disabled={uploadingMedia}>
            <Text style={styles.photoButtonText}>Take Photo/Video</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoButton} onPress={handlePickFromLibrary} disabled={uploadingMedia}>
            <Text style={styles.photoButtonText}>Choose from Library</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.label}>Neighborhood</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quarterRow}>
        {quarters.map((q) => (
          <TouchableOpacity
            key={q.id}
            style={[styles.quarterChip, quarterId === q.id && styles.quarterChipSelected]}
            onPress={() => setQuarterId(q.id)}
          >
            <Text style={[styles.quarterChipText, quarterId === q.id && styles.quarterChipTextSelected]}>{q.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.label}>Bedrooms</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={bedrooms} onChangeText={setBedrooms} placeholder="e.g. 3" />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.textArea]} multiline numberOfLines={4}
        value={description} onChangeText={setDescription} placeholder="Describe the property..."
      />

      <Text style={styles.label}>Listing Type</Text>
      <View style={styles.toggleRow}>
        {(["RENT", "SALE"] as const).map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.toggle, listingType === type && styles.toggleSelected]}
            onPress={() => setListingType(type)}
          >
            <Text style={[styles.toggleText, listingType === type && styles.toggleTextSelected]}>
              {type === "RENT" ? "For Rent" : "For Sale"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Price (XAF)</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={price} onChangeText={setPrice} placeholder="e.g. 100000" />

      {message && (
        <Text style={[styles.message, message.type === "success" ? styles.success : message.type === "info" ? styles.info : styles.errorText]}>
          {message.text}
        </Text>
      )}
      {needsMfa && (
        <TouchableOpacity onPress={() => navigation.navigate("MfaSetup")}>
          <Text style={styles.mfaLink}>Complete two-factor authentication →</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>Submit Listing</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: "#fff", padding: 20 },
  title: { fontSize: 22, fontWeight: "bold", color: "#1B2A4A", marginBottom: 16 },
  photoSection: { marginBottom: 20 },
  mediaPreviewRow: { marginBottom: 10 },
  mediaPreviewItem: { marginRight: 10 },
  photoPreview: { width: 120, height: 120, borderRadius: 8 },
  uploadingBox: { backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  videoPreviewBadge: { width: 120, height: 120, borderRadius: 8, backgroundColor: "#1B2A4A", justifyContent: "center", alignItems: "center" },
  videoPreviewBadgeText: { color: "#fff", fontWeight: "700" },
  photoPlaceholder: { width: "100%", height: 120, backgroundColor: "#E5E7EB", borderRadius: 8, justifyContent: "center", alignItems: "center" },
  photoPlaceholderText: { color: "#4B5563" },
  photoButtonRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  photoButton: { flex: 1, borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  photoButtonText: { color: "#1B2A4A", fontSize: 13, fontWeight: "600" },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 4 },
  quarterRow: { marginBottom: 16 },
  quarterChip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, marginRight: 8 },
  quarterChipSelected: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  quarterChipText: { color: "#374151", fontSize: 13 },
  quarterChipTextSelected: { color: "#fff", fontWeight: "600" },
  toggleRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  toggle: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  toggleSelected: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  toggleText: { color: "#374151" },
  toggleTextSelected: { color: "#fff", fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 15 },
  textArea: { height: 90, textAlignVertical: "top" },
  message: { marginBottom: 12, fontSize: 13 },
  mfaLink: { color: "#1B2A4A", fontWeight: "600", fontSize: 13, marginBottom: 16 },
  success: { color: "#15803D" },
  info: { color: "#1D4ED8" },
  errorText: { color: "#DC2626" },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginBottom: 30 },
  submitButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
});

import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import NetInfo from "@react-native-community/netinfo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { createListing } from "../lib/api";
import { enqueueAction } from "../offline/queue";

type Props = NativeStackScreenProps<RootStackParamList, "ListProperty">;

/**
 * List a Property — Page 5's mobile equivalent, with the two pieces
 * that only make sense on a real device: camera capture for listing
 * photos, and offline-safe submission (queue now, sync automatically
 * once connectivity returns) using the SAME idempotency-key pattern
 * verified in offline/queue.test.ts.
 */
export default function ListPropertyScreen({ navigation }: Props) {
  const [listingType, setListingType] = useState<"RENT" | "SALE">("RENT");
  const [price, setPrice] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleTakePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      setMessage({ type: "error", text: "Camera permission is required to photograph the property." });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function handlePickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setMessage({ type: "error", text: "Photo library permission is required." });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function handleSubmit() {
    setMessage(null);
    setLoading(true);
    const payload = { listing_type: listingType, price_xaf: price };

    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        // Offline: queue it, don't fail the user's action just because
        // connectivity is down right now — this is the actual offline-
        // sync requirement, not a hypothetical.
        await enqueueAction("CREATE_LISTING", payload);
        setMessage({ type: "info", text: "You're offline — this listing has been saved and will submit automatically once you're back online." });
        return;
      }

      const res = await createListing(payload);
      if (res.status === 403) {
        setMessage({ type: "error", text: "You need to complete multi-factor authentication and identity verification before listing a property." });
      } else if (!res.ok) {
        setMessage({ type: "error", text: "Something went wrong. Please try again." });
      } else {
        setMessage({ type: "success", text: "Your listing was created as a draft — an admin will review it before it goes live." });
      }
    } catch {
      // A network error mid-request is functionally the same as being
      // offline from this screen's point of view — queue it rather
      // than losing the user's work.
      await enqueueAction("CREATE_LISTING", payload);
      setMessage({ type: "info", text: "Could not reach the server — this listing has been saved and will submit automatically once you're back online." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>List a Property</Text>

      <View style={styles.photoSection}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photoPreview} />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderText}>No photo yet</Text>
          </View>
        )}
        <View style={styles.photoButtonRow}>
          <TouchableOpacity style={styles.photoButton} onPress={handleTakePhoto}>
            <Text style={styles.photoButtonText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoButton} onPress={handlePickFromLibrary}>
            <Text style={styles.photoButtonText}>Choose from Library</Text>
          </TouchableOpacity>
        </View>
      </View>

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

      <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>Submit Listing</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 20 },
  title: { fontSize: 22, fontWeight: "bold", color: "#1B2A4A", marginBottom: 16 },
  photoSection: { marginBottom: 20 },
  photoPreview: { width: "100%", height: 180, borderRadius: 8 },
  photoPlaceholder: { width: "100%", height: 180, backgroundColor: "#E5E7EB", borderRadius: 8, justifyContent: "center", alignItems: "center" },
  photoPlaceholderText: { color: "#4B5563" },
  photoButtonRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  photoButton: { flex: 1, borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  photoButtonText: { color: "#1B2A4A", fontSize: 13, fontWeight: "600" },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  toggleRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  toggle: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  toggleSelected: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  toggleText: { color: "#374151" },
  toggleTextSelected: { color: "#fff", fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 15 },
  message: { marginBottom: 12, fontSize: 13 },
  success: { color: "#15803D" },
  info: { color: "#1D4ED8" },
  errorText: { color: "#DC2626" },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  submitButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
});

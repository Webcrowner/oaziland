import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, ActivityIndicator, ScrollView, Switch } from "react-native";
import * as ImagePicker from "expo-image-picker";
import NetInfo from "@react-native-community/netinfo";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  createHouse, createListing, listQuarters, uploadMediaFile, addListingPhoto,
  setPropertyAmenities, setPropertyHouseRules, listPointsOfInterest, setNearbyFacilities, attachListingCondition,
  type Quarter, type MediaUploadResult, type PointOfInterestItem,
} from "../lib/api";
import { enqueueAction } from "../offline/queue";

type Props = NativeStackScreenProps<RootStackParamList, "ListProperty">;

interface PendingMedia extends MediaUploadResult {
  localUri: string;
}

const AMENITIES = [
  "PARKING", "BACKUP_GENERATOR", "BOREHOLE_WATER_TANK", "SECURITY_24_7", "FENCED_COMPOUND",
  "SWIMMING_POOL", "AIR_CONDITIONING", "FURNISHED", "SOLAR_POWER", "CCTV", "BALCONY_TERRACE", "WIFI_READY",
];
const HOUSE_RULES = ["NO_PETS", "NO_SMOKING_INDOORS", "NO_SUBLETTING", "NO_PARTIES", "QUIET_HOURS_AFTER_10PM", "ADVANCE_NOTICE_FOR_VISITS"];
// Mirrors the real backend HouseStyle choices exactly — mobile parity
// with the web app's list-property page, same session. OTHER pairs
// with a free-text field so a lister is never blocked by an
// incomplete list.
const HOUSE_TYPES = ["ROOM", "STUDIO", "SELF_CONTAIN", "APARTMENT", "STANDARD", "DUPLEX", "BUNGALOW", "DETACHED_VILLA", "CHALET", "OTHER"];

/**
 * List a Property — the mobile equivalent of the web app's real
 * property-creation wizard, now with real amenities, house rules,
 * nearby facilities, a house-type dropdown, and conditions/rules —
 * mobile parity with everything added to web's list-property page
 * this same session.
 */
export default function ListPropertyScreen({ navigation }: Props) {
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [quarterId, setQuarterId] = useState("");
  const [houseType, setHouseType] = useState("STANDARD");
  const [customHouseType, setCustomHouseType] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [description, setDescription] = useState("");
  const [listingType, setListingType] = useState<"RENT" | "SALE">("RENT");
  const [price, setPrice] = useState("");
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const [pointsOfInterest, setPointsOfInterest] = useState<PointOfInterestItem[]>([]);
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [minLeaseMonths, setMinLeaseMonths] = useState("");
  const [depositRequired, setDepositRequired] = useState(false);
  const [conditionsNotes, setConditionsNotes] = useState("");
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

  // Real nearby facilities are quarter-specific — refetched whenever
  // the selected quarter changes, matching the exact pattern already
  // established on web.
  useEffect(() => {
    if (!quarterId) return;
    listPointsOfInterest(quarterId).then(setPointsOfInterest).catch(() => setPointsOfInterest([]));
    setSelectedFacilities([]);
  }, [quarterId]);

  function toggleAmenity(value: string) {
    setSelectedAmenities((prev) => (prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]));
  }
  function toggleRule(value: string) {
    setSelectedRules((prev) => (prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]));
  }
  function toggleFacility(value: string) {
    setSelectedFacilities((prev) => (prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]));
  }

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
    if (houseType === "OTHER" && !customHouseType.trim()) {
      setMessage({ type: "error", text: "Please describe the property type." });
      return;
    }
    setLoading(true);

    const housePayload = {
      quarter: quarterId,
      bedrooms: bedrooms ? Number(bedrooms) : undefined,
      description: description || undefined,
      house_style: houseType,
      custom_house_style: houseType === "OTHER" ? customHouseType : undefined,
    };
    const combinedPayload = { house: housePayload, listing_type: listingType, price_xaf: price };

    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        // Offline: same real two-step queued flow already
        // established. Amenities/rules/facilities/conditions are
        // deliberately NOT part of the offline queue, matching the
        // same honest scope already established for photos in this
        // exact file — they require a real listing id that doesn't
        // exist until the queued creation actually runs online.
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

      if (selectedAmenities.length > 0) {
        await setPropertyAmenities("HOUSE", house.id, selectedAmenities).catch(() => {});
      }
      if (selectedRules.length > 0) {
        await setPropertyHouseRules(house.id, selectedRules).catch(() => {});
      }
      if (selectedFacilities.length > 0) {
        await setNearbyFacilities(house.id, selectedFacilities).catch(() => {});
      }

      const listingRes = await createListing({ property_asset_id: house.id, listing_type: listingType, price_xaf: price });
      if (!listingRes.ok) {
        setMessage({ type: "error", text: "The property was saved, but the listing itself could not be created. Please try again." });
        return;
      }
      const listing = await listingRes.json();

      await Promise.all(media.map((m) => addListingPhoto(listing.id, m.url, m.media_type)));

      if (minLeaseMonths || depositRequired || conditionsNotes) {
        const structuredConditions: Record<string, unknown> = {};
        if (minLeaseMonths) structuredConditions.min_lease_months = Number(minLeaseMonths);
        if (depositRequired) structuredConditions.deposit_required = true;
        await attachListingCondition({
          target_content_type: "property.Listing", target_id: listing.id,
          structured_conditions: structuredConditions, free_text_clause: conditionsNotes,
        }).catch(() => {});
      }

      setMessage({ type: "success", text: "Your listing was created — it goes live once an admin reviews it." });
    } catch {
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
                  <View style={styles.videoPreviewBadge}><Text style={styles.videoPreviewBadgeText}>▶ Video</Text></View>
                ) : (
                  <Image source={{ uri: m.localUri }} style={styles.photoPreview} />
                )}
              </View>
            ))}
            {uploadingMedia && <View style={[styles.photoPreview, styles.uploadingBox]}><ActivityIndicator color="#1B2A4A" /></View>}
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {quarters.map((q) => (
          <TouchableOpacity key={q.id} style={[styles.chip, quarterId === q.id && styles.chipSelected]} onPress={() => setQuarterId(q.id)}>
            <Text style={[styles.chipText, quarterId === q.id && styles.chipTextSelected]}>{q.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.label}>Property Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {HOUSE_TYPES.map((type) => (
          <TouchableOpacity key={type} style={[styles.chip, houseType === type && styles.chipSelected]} onPress={() => setHouseType(type)}>
            <Text style={[styles.chipText, houseType === type && styles.chipTextSelected]}>{type.replace(/_/g, " ")}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {houseType === "OTHER" && (
        <TextInput style={styles.input} placeholder="Describe the property type" value={customHouseType} onChangeText={setCustomHouseType} />
      )}

      <Text style={styles.label}>Bedrooms</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={bedrooms} onChangeText={setBedrooms} placeholder="e.g. 3" />

      <Text style={styles.label}>Description</Text>
      <TextInput style={[styles.input, styles.textArea]} multiline numberOfLines={4} value={description} onChangeText={setDescription} placeholder="Describe the property..." />

      <Text style={styles.label}>Amenities</Text>
      <View style={styles.checkGrid}>
        {AMENITIES.map((a) => (
          <TouchableOpacity key={a} style={styles.checkItem} onPress={() => toggleAmenity(a)}>
            <View style={[styles.checkbox, selectedAmenities.includes(a) && styles.checkboxChecked]} />
            <Text style={styles.checkLabel}>{a.replace(/_/g, " ")}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>House Rules</Text>
      <View style={styles.checkGrid}>
        {HOUSE_RULES.map((r) => (
          <TouchableOpacity key={r} style={styles.checkItem} onPress={() => toggleRule(r)}>
            <View style={[styles.checkbox, selectedRules.includes(r) && styles.checkboxChecked]} />
            <Text style={styles.checkLabel}>{r.replace(/_/g, " ")}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {pointsOfInterest.length > 0 && (
        <>
          <Text style={styles.label}>Nearby Facilities</Text>
          <View style={styles.checkGrid}>
            {pointsOfInterest.map((poi) => (
              <TouchableOpacity key={poi.id} style={styles.checkItem} onPress={() => toggleFacility(poi.id)}>
                <View style={[styles.checkbox, selectedFacilities.includes(poi.id) && styles.checkboxChecked]} />
                <Text style={styles.checkLabel}>{poi.name} ({poi.poi_type_display})</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>Listing Type</Text>
      <View style={styles.toggleRow}>
        {(["RENT", "SALE"] as const).map((type) => (
          <TouchableOpacity key={type} style={[styles.toggle, listingType === type && styles.toggleSelected]} onPress={() => setListingType(type)}>
            <Text style={[styles.toggleText, listingType === type && styles.toggleTextSelected]}>{type === "RENT" ? "For Rent" : "For Sale"}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Price (XAF)</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={price} onChangeText={setPrice} placeholder="e.g. 100000" />

      <Text style={styles.label}>Conditions & Rules (optional)</Text>
      <TextInput style={styles.input} keyboardType="numeric" placeholder="Minimum lease (months)" value={minLeaseMonths} onChangeText={setMinLeaseMonths} />
      <View style={styles.switchRow}>
        <Text style={styles.checkLabel}>Deposit required</Text>
        <Switch value={depositRequired} onValueChange={setDepositRequired} />
      </View>
      <TextInput style={[styles.input, styles.textArea]} multiline numberOfLines={2} placeholder="Any other conditions or rules..." value={conditionsNotes} onChangeText={setConditionsNotes} />

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
  chipRow: { marginBottom: 16 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, marginRight: 8 },
  chipSelected: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipText: { color: "#374151", fontSize: 13 },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  checkGrid: { marginBottom: 16 },
  checkItem: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: "#9CA3AF", marginRight: 8 },
  checkboxChecked: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  checkLabel: { fontSize: 13, color: "#374151" },
  toggleRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  toggle: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  toggleSelected: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  toggleText: { color: "#374151" },
  toggleTextSelected: { color: "#fff", fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 15 },
  textArea: { height: 70, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  message: { marginBottom: 12, fontSize: 13 },
  mfaLink: { color: "#1B2A4A", fontWeight: "600", fontSize: 13, marginBottom: 16 },
  success: { color: "#15803D" },
  info: { color: "#1D4ED8" },
  errorText: { color: "#DC2626" },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginBottom: 30 },
  submitButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
});

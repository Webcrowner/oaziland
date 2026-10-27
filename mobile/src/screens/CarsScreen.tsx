import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Image, ActivityIndicator, Modal, ScrollView, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import {
  createMarketplaceListing, addMarketplaceMedia, listQuarters, uploadMediaFile,
  type CarListing, type Quarter, type MediaUploadResult,
} from "../lib/api";
import { useMarketplaceListings } from "../lib/useMarketplaceListings";
import LoadMoreButton from "../components/LoadMoreButton";
import type { RootStackParamList } from "../navigation/AppNavigator";
import MarketplaceFilterBar from "../components/MarketplaceFilterBar";
import { EMPTY_MARKETPLACE_FILTERS, filtersActive, filtersToQuery, type MarketplaceFilters } from "../lib/marketplaceFilters";
import MarketplaceFormLocation from "../components/MarketplaceFormLocation";
import type { Coords } from "../lib/location";
import MarketplacePriceFields from "../components/MarketplacePriceFields";
import MarketplaceConditionsFields, { saveConditions } from "../components/MarketplaceConditionsFields";
import { conditionsError, EMPTY_CONDITIONS, type ConditionsDraft } from "../lib/marketplaceConditions";
import { depositFor } from "../lib/marketplacePricing";

const PRICE_BASIS_OPTIONS = ["SALE", "RENT_NIGHTLY", "RENT_WEEKLY", "RENT_MONTHLY", "RENT_ANNUAL"];

/**
 * Cars — mobile parity with the web app's /marketplace/cars page,
 * built this same session. Real browse, real create with a composed
 * VehicleSpec, and real photo upload reusing the same uploadMediaFile
 * flow already proven on ListPropertyScreen.
 */
export default function CarsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [filters, setFilters] = useState<MarketplaceFilters>(EMPTY_MARKETPLACE_FILTERS);
  const { items: listings, loading, hasMore, loadingMore, loadMore, reload } = useMarketplaceListings<CarListing>("cars", filtersToQuery(filters));
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [mileage, setMileage] = useState("");
  const [engineSize, setEngineSize] = useState("");
  const [priceBasis, setPriceBasis] = useState("SALE");
  const [price, setPrice] = useState("");
  const [deposit, setDeposit] = useState("");
  const [conditions, setConditions] = useState<ConditionsDraft>(EMPTY_CONDITIONS);
  const [quarterId, setQuarterId] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listQuarters().then((data) => {
      setQuarters(data);
      if (data.length > 0) setQuarterId(data[0].id);
    }).catch(() => {});
  }, []);

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
    const invalidConditions = conditionsError("cars", conditions);
    if (invalidConditions) {
      setError(invalidConditions);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const listing = await createMarketplaceListing("cars", {
        title, description, price_basis: priceBasis, price_xaf: price, security_deposit_xaf: depositFor(priceBasis, deposit), quarter: quarterId || null,
        latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
        vehicle_spec: {
          make, model, year: Number(year), mileage_km: mileage ? Number(mileage) : null,
          engine_size_cc: engineSize ? Number(engineSize) : null,
        },
      });
      await Promise.all(media.map((m) => addMarketplaceMedia("cars", listing.id, m.url, m.media_type)));
      await saveConditions("cars", listing.id, conditions, true).catch(() => Alert.alert("Listing posted", "Its conditions could not be saved. Add them from My listings."));
      setShowForm(false);
      setTitle(""); setDescription(""); setMake(""); setModel(""); setYear(""); setMileage(""); setEngineSize(""); setPrice(""); setDeposit(""); setConditions(EMPTY_CONDITIONS); setCoords(null); setMedia([]);
      reload();
    } catch {
      setError("Could not create listing. Please check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
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
              <Text style={styles.listButtonText}>List a Car</Text>
            </TouchableOpacity>
            <MarketplaceFilterBar value={filters} onChange={setFilters} />
          </View>
        }
        ListFooterComponent={hasMore ? <LoadMoreButton onPress={loadMore} loading={loadingMore} /> : null}
        ListEmptyComponent={<Text style={styles.empty}>{filtersActive(filters) ? "No listings match your filters." : "No cars listed yet."}</Text>}
        renderItem={({ item }) => {
          const photo = item.media.find((m) => m.media_type === "PHOTO");
          return (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("MarketplaceListingDetail", { category: "cars", listingId: item.id })}>
              {photo ? (
                <Image source={{ uri: photo.file_url }} style={styles.cardImage} />
              ) : (
                <View style={styles.imagePlaceholder}><Text style={styles.imagePlaceholderText}>No photo yet</Text></View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardSubtitle}>{item.vehicle_spec.year} {item.vehicle_spec.make} {item.vehicle_spec.model}</Text>
                <Text style={styles.price}>{Number(item.price_xaf).toLocaleString()} XAF</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <ScrollView contentContainerStyle={styles.formContainer}>
          <Text style={styles.formTitle}>List a Car</Text>
          <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} />
          <TextInput style={styles.input} placeholder="Description" value={description} onChangeText={setDescription} multiline numberOfLines={3} />
          <TextInput style={styles.input} placeholder="Make (e.g. Toyota)" value={make} onChangeText={setMake} />
          <TextInput style={styles.input} placeholder="Model (e.g. Corolla)" value={model} onChangeText={setModel} />
          <TextInput style={styles.input} placeholder="Year" value={year} onChangeText={setYear} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder="Mileage (km, optional)" value={mileage} onChangeText={setMileage} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder="Engine size (cc, optional)" value={engineSize} onChangeText={setEngineSize} keyboardType="numeric" />
          <MarketplacePriceFields price={price} onPriceChange={setPrice} priceBasis={priceBasis} onPriceBasisChange={setPriceBasis} deposit={deposit} onDepositChange={setDeposit} />
          <MarketplaceFormLocation quarters={quarters} quarterId={quarterId} onQuarterChange={setQuarterId} coords={coords} onCoordsChange={setCoords} />
          <MarketplaceConditionsFields category="cars" value={conditions} onChange={setConditions} />

          <TouchableOpacity style={styles.photoButton} onPress={handlePickPhoto} disabled={uploadingMedia}>
            {uploadingMedia ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.photoButtonText}>Add Photo or Video</Text>}
          </TouchableOpacity>
          {media.length > 0 && <Text style={styles.mediaCount}>{media.length} file(s) attached</Text>}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>Submit Listing</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowForm(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
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

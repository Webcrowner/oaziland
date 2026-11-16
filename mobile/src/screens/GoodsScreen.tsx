import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Image, ActivityIndicator, Modal, ScrollView, Switch, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { addMarketplaceMedia, createMarketplaceListing, listQuarters, uploadMediaFile, type GoodsListing, type MediaUploadResult, type Quarter } from "../lib/api";
import { useMarketplaceListings } from "../lib/useMarketplaceListings";
import LoadMoreButton from "../components/LoadMoreButton";
import TopBadge from "../components/TopBadge";
import SalePrice from "../components/SalePrice";
import type { RootStackParamList } from "../navigation/AppNavigator";
import MarketplaceFilterBar from "../components/MarketplaceFilterBar";
import MarketplaceFormLocation from "../components/MarketplaceFormLocation";
import { EMPTY_MARKETPLACE_FILTERS, filtersActive, filtersToQuery, type MarketplaceFilters } from "../lib/marketplaceFilters";
import {
  EMPTY_GOODS_DRAFT, GOODS_CATEGORIES, GOODS_CONDITIONS, MAX_GOODS_MEDIA, goodsDraftError, goodsPayload, listingErrorText, type GoodsDraft,
} from "../lib/goodsListing";
import type { Coords } from "../lib/location";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

/** Goods for sale: browse, open one and buy it with a quantity and a delivery choice, or post your own. */
export default function GoodsScreen() {
  const { t } = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [filters, setFilters] = useState<MarketplaceFilters>(EMPTY_MARKETPLACE_FILTERS);
  const { items: listings, loading, hasMore, loadingMore, loadMore, reload } = useMarketplaceListings<GoodsListing>("goods", filtersToQuery(filters));
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<GoodsDraft>(EMPTY_GOODS_DRAFT);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const setField = <K extends keyof GoodsDraft>(key: K, value: GoodsDraft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    listQuarters().then((data) => {
      setQuarters(data);
      setDraft((prev) => (prev.quarterId || data.length === 0 ? prev : { ...prev, quarterId: data[0].id }));
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
      setMedia((prev) => (prev.length >= MAX_GOODS_MEDIA ? prev : [...prev, uploaded]));
    } catch {
      setError(t("goods.form.uploadFailed"));
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handleSubmit() {
    const invalid = goodsDraftError(draft);
    if (invalid) {
      setError(t(invalid));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const listing = await createMarketplaceListing("goods", goodsPayload(draft, coords));
      // The item exists now: a file that fails to attach must not make the seller post it twice.
      const results = await Promise.allSettled(media.map((m) => addMarketplaceMedia("goods", listing.id, m.url, m.media_type)));
      const failed = results.filter((r) => r.status === "rejected").length;
      setShowForm(false);
      setDraft({ ...EMPTY_GOODS_DRAFT, quarterId: draft.quarterId });
      setCoords(null);
      setMedia([]);
      if (failed) Alert.alert(t("goods.form.postedTitle"), t("goods.form.mediaFailed", { count: failed }));
      reload();
    } catch (err) {
      setError(listingErrorText(err, t("goods.form.failed")));
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
              <Text style={styles.listButtonText}>{t("goods.sell")}</Text>
            </TouchableOpacity>
            <MarketplaceFilterBar value={filters} onChange={setFilters} showPriceBasis={false} />
          </View>
        }
        ListFooterComponent={hasMore ? <LoadMoreButton onPress={loadMore} loading={loadingMore} /> : null}
        ListEmptyComponent={<Text style={styles.empty}>{filtersActive(filters) ? "No goods match your filters." : "No goods listed yet."}</Text>}
        renderItem={({ item }) => {
          const photo = item.media.find((m) => m.media_type === "PHOTO");
          return (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("MarketplaceListingDetail", { category: "goods", listingId: item.id })}>
              {photo ? <Image source={{ uri: photo.file_url }} style={styles.cardImage} /> : (
                <View style={styles.imagePlaceholder}><Text style={styles.imagePlaceholderText}>No photo yet</Text></View>
              )}
              <View style={styles.cardBody}>
                {item.is_boosted && <TopBadge />}
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.stock}>{item.quantity > 0 ? `${item.quantity} in stock` : "Sold out"}</Text>
                <SalePrice listing={item} />
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
          <Text style={styles.formTitle}>{t("goods.form.title")}</Text>
          <TextInput style={styles.input} placeholder={t("goods.form.itemTitle")} value={draft.title} onChangeText={(v) => setField("title", v)} maxLength={200} />

          <Text style={styles.label}>{t("goods.form.category")}</Text>
          <View style={styles.chips}>
            {GOODS_CATEGORIES.map((c) => (
              <TouchableOpacity key={c} style={[styles.chip, draft.itemCategory === c && styles.chipOn]} onPress={() => setField("itemCategory", c)}>
                <Text style={[styles.chipText, draft.itemCategory === c && styles.chipTextOn]}>{t(`goods.cat.${c}` as MessageKey)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{t("goods.form.condition")}</Text>
          <View style={styles.chips}>
            {GOODS_CONDITIONS.map((c) => (
              <TouchableOpacity key={c} style={[styles.chip, draft.condition === c && styles.chipOn]} onPress={() => setField("condition", c)}>
                <Text style={[styles.chipText, draft.condition === c && styles.chipTextOn]}>{t(`goods.cond.${c}` as MessageKey)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput style={styles.input} placeholder={t("goods.form.price")} value={draft.price} onChangeText={(v) => setField("price", v)} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder={t("goods.form.compareAt")} value={draft.compareAt} onChangeText={(v) => setField("compareAt", v)} keyboardType="numeric" accessibilityLabel={t("goods.form.compareAt")} />
          <TextInput style={styles.input} placeholder={t("goods.form.quantity")} value={draft.quantity} onChangeText={(v) => setField("quantity", v)} keyboardType="number-pad" />
          <TextInput style={styles.input} placeholder={t("goods.form.description")} value={draft.description} onChangeText={(v) => setField("description", v)} multiline numberOfLines={3} />

          <Text style={styles.label}>{t("goods.form.delivery")}</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t("goods.form.pickup")}</Text>
            <Switch value={draft.pickup} onValueChange={(v) => setField("pickup", v)} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t("goods.form.sellerDelivery")}</Text>
            <Switch value={draft.sellerDelivery} onValueChange={(v) => setField("sellerDelivery", v)} />
          </View>
          {draft.sellerDelivery && (
            <>
              <TextInput style={styles.input} placeholder={t("goods.form.sellerFee")} value={draft.sellerFee} onChangeText={(v) => setField("sellerFee", v)} keyboardType="numeric" />
              <TextInput style={styles.input} placeholder={t("goods.form.sellerAreas")} value={draft.sellerAreas} onChangeText={(v) => setField("sellerAreas", v)} maxLength={200} />
            </>
          )}
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t("goods.form.courier")}</Text>
            <Switch value={draft.courier} onValueChange={(v) => setField("courier", v)} />
          </View>
          {draft.courier && (
            <>
              <TextInput style={styles.input} placeholder={t("goods.form.courierFee")} value={draft.courierFee} onChangeText={(v) => setField("courierFee", v)} keyboardType="numeric" />
              <TextInput style={styles.input} placeholder={t("goods.form.courierNote")} value={draft.courierNote} onChangeText={(v) => setField("courierNote", v)} maxLength={200} />
            </>
          )}

          <MarketplaceFormLocation quarters={quarters} quarterId={draft.quarterId} onQuarterChange={(id) => setField("quarterId", id)} coords={coords} onCoordsChange={setCoords} />

          <TouchableOpacity style={styles.photoButton} onPress={handlePickPhoto} disabled={uploadingMedia || media.length >= MAX_GOODS_MEDIA}>
            {uploadingMedia ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.photoButtonText}>{t("goods.form.addPhoto")}</Text>}
          </TouchableOpacity>
          {media.length > 0 && <Text style={styles.mediaCount}>{t("goods.form.attached", { count: media.length, max: MAX_GOODS_MEDIA })}</Text>}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>{t("goods.form.submit")}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowForm(false)}><Text style={styles.cancelText}>{t("goods.form.cancel")}</Text></TouchableOpacity>
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
  formContainer: { padding: 20, paddingTop: 50 },
  formTitle: { fontSize: 20, fontWeight: "700", color: "#1B2A4A", marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#fff" },
  chipOn: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  chipTextOn: { color: "#fff" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  switchLabel: { fontSize: 14, color: "#374151", flex: 1, paddingRight: 12 },
  photoButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 8 },
  photoButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  mediaCount: { fontSize: 12, color: "#6B7280", marginBottom: 12 },
  errorText: { color: "#DC2626", fontSize: 13, marginBottom: 12 },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginBottom: 12 },
  submitButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 16 },
  cancelText: { textAlign: "center", color: "#6B7280", marginBottom: 24 },
  card: { backgroundColor: "#fff", borderRadius: 10, marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  cardImage: { height: 140, width: "100%" },
  imagePlaceholder: { height: 140, backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  imagePlaceholderText: { color: "#4B5563" },
  cardBody: { padding: 12 },
  cardTitle: { fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  stock: { fontSize: 12, color: "#6B7280", marginBottom: 6 },
  price: { fontSize: 16, fontWeight: "700", color: "#1B2A4A" },
});

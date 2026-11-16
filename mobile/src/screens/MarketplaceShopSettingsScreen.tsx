import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert, Switch, Image, Linking } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  createMyCoupon, deleteMyCoupon, getMyShopSettings, getMyUserId, listMyCoupons, saveMyShopSettings, updateMyCoupon,
  type CouponKind, type MarketplaceCoupon,
} from "../lib/api";
import {
  EMPTY_SHOP_DRAFT, SHOP_LIMITS, shopDraftError, shopDraftFrom, shopPayload, type ShopDraft,
} from "../lib/marketplaceShop";
import {
  couponDiscountLabel, couponDraftError, couponPayload, couponStatusLabel, EMPTY_COUPON_DRAFT, type CouponDraft,
} from "../lib/marketplaceCoupons";
import { MOMENT_FORMAT_HINT } from "../lib/dateTimeInput";
import { pickAndUploadPhoto } from "../lib/pickImage";
import { useI18n } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceShopSettings">;

/** The seller's storefront settings: profile, policies, vacation mode, discount codes and where to manage staff. */
export default function MarketplaceShopSettingsScreen({ navigation }: Props) {
  const { language } = useI18n();
  const [state, setState] = useState<"loading" | "signedOut" | "ready" | "failed">("loading");
  const [draft, setDraft] = useState<ShopDraft>(EMPTY_SHOP_DRAFT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<"logo" | "banner" | null>(null);
  const [coupons, setCoupons] = useState<MarketplaceCoupon[]>([]);
  const [couponError, setCouponError] = useState("");
  const [couponDraft, setCouponDraft] = useState<CouponDraft>(EMPTY_COUPON_DRAFT);
  const [creating, setCreating] = useState(false);

  const set = <K extends keyof ShopDraft>(key: K, value: ShopDraft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const setCouponField = <K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) => setCouponDraft((prev) => ({ ...prev, [key]: value }));

  const loadCoupons = useCallback(() => {
    listMyCoupons().then(setCoupons).catch((err) => setCouponError(err instanceof Error ? err.message : "Could not load your coupons."));
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync("access_token").then(async (token) => {
      if (!token) {
        setState("signedOut");
        return;
      }
      try {
        setDraft(shopDraftFrom(await getMyShopSettings()));
        setState("ready");
        loadCoupons();
      } catch {
        setState("failed");
      }
    });
  }, [loadCoupons]);

  async function handleSave() {
    const invalid = shopDraftError(draft);
    if (invalid) {
      setError(invalid);
      setMessage("");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      setDraft(shopDraftFrom(await saveMyShopSettings(shopPayload(draft))));
      setMessage("Your shop was saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your shop. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePickImage(kind: "logo" | "banner") {
    setUploading(kind);
    setError("");
    try {
      const url = await pickAndUploadPhoto("marketplace");
      if (url) set(kind === "logo" ? "logoUrl" : "bannerUrl", url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the picture.");
    } finally {
      setUploading(null);
    }
  }

  async function handleCreateCoupon() {
    const invalid = couponDraftError(couponDraft);
    if (invalid) {
      setCouponError(invalid);
      return;
    }
    setCreating(true);
    setCouponError("");
    try {
      await createMyCoupon(couponPayload(couponDraft));
      setCouponDraft(EMPTY_COUPON_DRAFT);
      loadCoupons();
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : "Could not create the coupon.");
    } finally {
      setCreating(false);
    }
  }

  async function couponAction(action: () => Promise<unknown>) {
    setCouponError("");
    try {
      await action();
      loadCoupons();
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : "That did not work. Please try again.");
    }
  }

  function confirmDeleteCoupon(coupon: MarketplaceCoupon) {
    Alert.alert(`Delete ${coupon.code}?`, "Orders that already used it are not affected. To stop it without deleting, switch it off.", [
      { text: "No", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => couponAction(() => deleteMyCoupon(coupon.id)) },
    ]);
  }

  async function handleViewShop() {
    try {
      navigation.navigate("MarketplaceShop", { userId: await getMyUserId() });
    } catch {
      setError("Could not open your shop. Please try again.");
    }
  }

  if (state === "loading") return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  if (state === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Sign in to manage your shop.</Text>
        <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("Login")}><Text style={styles.primaryText}>Sign In</Text></TouchableOpacity>
      </View>
    );
  }
  if (state === "failed") return <View style={styles.centered}><Text style={styles.muted}>Could not load your shop settings. Please try again later.</Text></View>;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <TouchableOpacity style={styles.secondary} onPress={handleViewShop}><Text style={styles.secondaryText}>View my public shop</Text></TouchableOpacity>

      <Text style={styles.section}>Shop profile</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Banner</Text>
        {draft.bannerUrl ? <Image source={{ uri: draft.bannerUrl }} style={styles.banner} /> : <View style={[styles.banner, styles.imageEmpty]}><Text style={styles.imageEmptyText}>No banner</Text></View>}
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => handlePickImage("banner")} disabled={uploading !== null}>
            {uploading === "banner" ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.link}>{draft.bannerUrl ? "Change banner" : "Add banner"}</Text>}
          </TouchableOpacity>
          {draft.bannerUrl ? <TouchableOpacity onPress={() => set("bannerUrl", "")}><Text style={styles.danger}>Remove</Text></TouchableOpacity> : null}
        </View>

        <Text style={styles.label}>Logo</Text>
        {draft.logoUrl ? <Image source={{ uri: draft.logoUrl }} style={styles.logo} /> : <View style={[styles.logo, styles.imageEmpty]}><Text style={styles.imageEmptyText}>No logo</Text></View>}
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => handlePickImage("logo")} disabled={uploading !== null}>
            {uploading === "logo" ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.link}>{draft.logoUrl ? "Change logo" : "Add logo"}</Text>}
          </TouchableOpacity>
          {draft.logoUrl ? <TouchableOpacity onPress={() => set("logoUrl", "")}><Text style={styles.danger}>Remove</Text></TouchableOpacity> : null}
        </View>

        <TextInput style={styles.input} placeholder="Shop name" value={draft.name} onChangeText={(v) => set("name", v)} maxLength={SHOP_LIMITS.name} />
        <TextInput style={styles.input} placeholder="Tagline" value={draft.tagline} onChangeText={(v) => set("tagline", v)} maxLength={SHOP_LIMITS.tagline} />
        <TextInput style={[styles.input, styles.multiline]} placeholder="About your shop" value={draft.description} onChangeText={(v) => set("description", v)} multiline numberOfLines={4} />
        <TextInput style={styles.input} placeholder="Announcement shown at the top of your shop (optional)" value={draft.announcement} onChangeText={(v) => set("announcement", v)} maxLength={SHOP_LIMITS.announcement} />
      </View>

      <Text style={styles.section}>Policies</Text>
      <View style={styles.card}>
        <TextInput style={[styles.input, styles.multiline]} placeholder="Shipping policy" value={draft.shippingPolicy} onChangeText={(v) => set("shippingPolicy", v)} multiline numberOfLines={4} />
        <TextInput style={[styles.input, styles.multiline]} placeholder="Return policy" value={draft.returnPolicy} onChangeText={(v) => set("returnPolicy", v)} multiline numberOfLines={4} />
      </View>

      <Text style={styles.section}>Vacation mode</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Pause my shop. Your listings are hidden from browsing and buyers cannot order, add to cart or make offers.</Text>
          <Switch value={draft.onVacation} onValueChange={(v) => set("onVacation", v)} />
        </View>
        {draft.onVacation && (
          <>
            <TextInput style={styles.input} placeholder="Back on (YYYY-MM-DD, optional)" value={draft.vacationUntil} onChangeText={(v) => set("vacationUntil", v)} autoCorrect={false} />
            <TextInput style={styles.input} placeholder="Message to buyers (optional)" value={draft.vacationMessage} onChangeText={(v) => set("vacationMessage", v)} maxLength={SHOP_LIMITS.vacationMessage} />
          </>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      <TouchableOpacity style={[styles.primary, saving && styles.disabled]} disabled={saving} onPress={handleSave}>
        {saving ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.primaryText}>Save shop</Text>}
      </TouchableOpacity>

      <Text style={styles.section}>Discount codes</Text>
      <View style={styles.card}>
        {coupons.length === 0 ? <Text style={styles.muted}>You have no discount codes yet.</Text> : coupons.map((coupon) => (
          <View key={coupon.id} style={styles.couponRow}>
            <View style={styles.couponText}>
              <Text style={styles.couponCode}>{coupon.code}</Text>
              <Text style={styles.couponMeta}>{couponDiscountLabel(coupon)}</Text>
              <Text style={styles.couponMeta}>{couponStatusLabel(coupon)}</Text>
              <TouchableOpacity onPress={() => confirmDeleteCoupon(coupon)}><Text style={styles.danger}>Delete</Text></TouchableOpacity>
            </View>
            <Switch value={coupon.is_active} onValueChange={(is_active) => couponAction(() => updateMyCoupon(coupon.id, { is_active }))} accessibilityLabel={`${coupon.code} active`} />
          </View>
        ))}

        <Text style={styles.label}>New coupon</Text>
        <TextInput style={styles.input} placeholder="Code (e.g. WELCOME10)" value={couponDraft.code} onChangeText={(v) => setCouponField("code", v)} autoCapitalize="characters" autoCorrect={false} maxLength={30} />
        <View style={styles.chips}>
          {(["PERCENT", "FIXED"] as CouponKind[]).map((kind) => (
            <TouchableOpacity key={kind} style={[styles.chip, couponDraft.kind === kind && styles.chipOn]} onPress={() => setCouponField("kind", kind)}>
              <Text style={[styles.chipText, couponDraft.kind === kind && styles.chipTextOn]}>{kind === "PERCENT" ? "Percent off" : "Fixed amount off"}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={styles.input} placeholder={couponDraft.kind === "PERCENT" ? "Percent (1 to 90)" : "Amount off (XAF)"} value={couponDraft.value} onChangeText={(v) => setCouponField("value", v)} keyboardType="number-pad" />
        <TextInput style={styles.input} placeholder="Minimum order (XAF, optional)" value={couponDraft.minOrder} onChangeText={(v) => setCouponField("minOrder", v)} keyboardType="number-pad" />
        <TextInput style={styles.input} placeholder="Maximum uses (blank = unlimited)" value={couponDraft.maxUses} onChangeText={(v) => setCouponField("maxUses", v)} keyboardType="number-pad" />
        <TextInput style={styles.input} placeholder={`Starts (${MOMENT_FORMAT_HINT}, optional)`} value={couponDraft.startsAt} onChangeText={(v) => setCouponField("startsAt", v)} autoCorrect={false} />
        <TextInput style={styles.input} placeholder={`Expires (${MOMENT_FORMAT_HINT}, optional)`} value={couponDraft.expiresAt} onChangeText={(v) => setCouponField("expiresAt", v)} autoCorrect={false} />
        {couponError ? <Text style={styles.error}>{couponError}</Text> : null}
        <TouchableOpacity style={[styles.primary, creating && styles.disabled]} disabled={creating} onPress={handleCreateCoupon}>
          {creating ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.primaryText}>Create coupon</Text>}
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Team</Text>
      <View style={styles.card}>
        <Text style={styles.muted}>Give trusted staff access to help run your shop (listings, orders, coupons) without sharing your password. Staff accounts are managed in Staff & Team Access.</Text>
        <TouchableOpacity style={styles.secondary} onPress={() => Linking.openURL(`https://oaziland.com/${language}/staff-access`).catch(() => setError("Could not open Staff & Team Access."))}>
          <Text style={styles.secondaryText}>Open Staff & Team Access</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  muted: { color: "#6B7280", fontSize: 13, marginBottom: 10 },
  section: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 4 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14 },
  multiline: { textAlignVertical: "top", minHeight: 80 },
  banner: { height: 110, width: "100%", borderRadius: 8, marginBottom: 6 },
  logo: { height: 72, width: 72, borderRadius: 36, marginBottom: 6 },
  imageEmpty: { backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  imageEmptyText: { color: "#4B5563", fontSize: 12 },
  actions: { flexDirection: "row", alignItems: "center", gap: 18, marginBottom: 10 },
  link: { color: "#1B2A4A", fontWeight: "600", textDecorationLine: "underline", fontSize: 13 },
  danger: { color: "#B91C1C", fontWeight: "600", textDecorationLine: "underline", fontSize: 13 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 },
  switchLabel: { flex: 1, fontSize: 13, color: "#374151" },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", marginBottom: 8 },
  primaryText: { color: "#1B2A4A", fontWeight: "700" },
  secondary: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 11, alignItems: "center", marginBottom: 8 },
  secondaryText: { color: "#1B2A4A", fontWeight: "700" },
  disabled: { opacity: 0.5 },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  success: { color: "#15803D", fontSize: 13, marginBottom: 8, fontWeight: "600" },
  couponRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 10, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  couponText: { flex: 1 },
  couponCode: { fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  couponMeta: { fontSize: 12, color: "#4B5563", marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#fff" },
  chipOn: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  chipTextOn: { color: "#fff" },
});

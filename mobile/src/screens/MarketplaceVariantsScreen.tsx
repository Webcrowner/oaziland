import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Switch, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getGoodsVariants, getMarketplaceListing, saveGoodsVariants, variantServerErrors, type GoodsListing } from "../lib/api";
import {
  EMPTY_VARIANTS_DRAFT, MAX_OPTION_NAMES, MAX_VARIANTS, addOptionName, addRow, draftFromVariants, groupVariantErrors, removeOptionName,
  rowLabel, rowPriceXaf, totalStock, variantsDraftError, variantsPayload, type VariantRowDraft, type VariantsDraft,
} from "../lib/variantEditor";
import { formatXaf } from "../lib/marketplaceCart";
import { useI18n } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceVariants">;

/** The seller's editor for the versions of one goods listing (size, colour...): names, stock, price difference and SKU. */
export default function MarketplaceVariantsScreen({ route, navigation }: Props) {
  const { listingId, title } = route.params;
  const { t } = useI18n();
  const [state, setState] = useState<"loading" | "signedOut" | "failed" | "ready">("loading");
  const [draft, setDraft] = useState<VariantsDraft>(EMPTY_VARIANTS_DRAFT);
  const [basePrice, setBasePrice] = useState(0);
  const [hadVariants, setHadVariants] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<number, string[]>>({});
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      setState("signedOut");
      return;
    }
    try {
      const [variants, listing] = await Promise.all([getGoodsVariants(listingId), getMarketplaceListing<GoodsListing>("goods", listingId)]);
      setBasePrice(Number(listing.price_xaf));
      setDraft(draftFromVariants(variants));
      setHadVariants(variants.length > 0);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [listingId]);

  useEffect(() => { load(); }, [load]);

  function edit(next: VariantsDraft) {
    setDraft(next);
    setNotice("");
  }

  function setName(index: number, value: string) {
    edit({ ...draft, names: draft.names.map((name, i) => (i === index ? value : name)) });
  }

  function setValue(rowIndex: number, valueIndex: number, value: string) {
    edit({ ...draft, rows: draft.rows.map((row, i) => (i === rowIndex ? { ...row, values: row.values.map((v, j) => (j === valueIndex ? value : v)) } : row)) });
  }

  function patchRow(rowIndex: number, patch: Partial<VariantRowDraft>) {
    edit({ ...draft, rows: draft.rows.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)) });
  }

  function removeRow(rowIndex: number) {
    edit({ ...draft, rows: draft.rows.filter((_, i) => i !== rowIndex) });
    setRowErrors({});
  }

  async function submit(next: VariantsDraft, removing: boolean) {
    setError("");
    setRowErrors({});
    setNotice("");
    if (!removing) {
      const issue = variantsDraftError(next, basePrice);
      if (issue) {
        if (issue.index === null) setError(t(issue.key));
        else setRowErrors({ [issue.index]: [t(issue.key)] });
        return;
      }
    }
    setSaving(true);
    try {
      const saved = await saveGoodsVariants(listingId, removing ? [] : variantsPayload(next));
      setDraft(draftFromVariants(saved.variants));
      setHadVariants(saved.variants.length > 0);
      setNotice(removing ? "" : t("variants.editor.saved", { count: saved.quantity }));
    } catch (err) {
      const grouped = groupVariantErrors(variantServerErrors(err));
      const hasRowErrors = Object.keys(grouped.rows).length > 0;
      setRowErrors(grouped.rows);
      setError(grouped.general.join(" ") || (hasRowErrors ? "" : err instanceof Error && err.message ? err.message : t("variants.editor.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  function confirmRemoveAll() {
    Alert.alert(t("variants.editor.removeAll"), t("variants.editor.removeAllConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.remove"), style: "destructive", onPress: () => submit(EMPTY_VARIANTS_DRAFT, true) },
    ]);
  }

  if (state === "loading") return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;

  if (state === "signedOut") {
    return (
      <View style={styles.centered}>
        <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("Login")}><Text style={styles.primaryText}>{t("common.signIn")}</Text></TouchableOpacity>
      </View>
    );
  }

  if (state === "failed") {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t("variants.editor.loadFailed")}</Text>
        <TouchableOpacity style={styles.primary} onPress={load}><Text style={styles.primaryText}>{t("common.tryAgain")}</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {title ? <Text style={styles.heading}>{title}</Text> : null}
      <Text style={styles.muted}>{t("variants.editor.intro")}</Text>

      <Text style={styles.section}>{t("variants.editor.names")}</Text>
      {draft.names.map((name, index) => (
        <View key={index} style={styles.nameRow}>
          <TextInput
            style={[styles.input, styles.nameInput]} value={name} onChangeText={(value) => setName(index, value)}
            placeholder={t("variants.editor.namePlaceholder")} maxLength={30}
          />
          {draft.names.length > 1 && (
            <TouchableOpacity style={styles.iconButton} onPress={() => edit(removeOptionName(draft, index))} accessibilityLabel={t("common.remove")}>
              <Text style={styles.danger}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      {draft.names.length < MAX_OPTION_NAMES && (
        <TouchableOpacity style={styles.secondary} onPress={() => edit(addOptionName(draft))}><Text style={styles.secondaryText}>{t("variants.editor.addName")}</Text></TouchableOpacity>
      )}

      <Text style={styles.section}>{t("variants.editor.versions")}</Text>
      {draft.rows.map((row, rowIndex) => (
        <View key={row.id ?? `new-${rowIndex}`} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle} numberOfLines={2}>{t("variants.editor.versionTitle", { number: rowIndex + 1, label: rowLabel(row) })}</Text>
            <TouchableOpacity style={styles.iconButton} onPress={() => removeRow(rowIndex)} accessibilityLabel={t("common.remove")}>
              <Text style={styles.danger}>✕</Text>
            </TouchableOpacity>
          </View>
          {draft.names.map((name, valueIndex) => (
            <View key={valueIndex}>
              <Text style={styles.label}>{name.trim() || `#${valueIndex + 1}`}</Text>
              <TextInput style={styles.input} value={row.values[valueIndex] ?? ""} onChangeText={(value) => setValue(rowIndex, valueIndex, value)} maxLength={40} />
            </View>
          ))}
          <View style={styles.pair}>
            <View style={styles.pairCell}>
              <Text style={styles.label}>{t("variants.editor.stock")}</Text>
              <TextInput style={styles.input} value={row.quantity} onChangeText={(quantity) => patchRow(rowIndex, { quantity })} keyboardType="number-pad" />
            </View>
            <View style={styles.pairCell}>
              <Text style={styles.label} numberOfLines={2}>{t("variants.editor.priceDelta")}</Text>
              <TextInput style={styles.input} value={row.priceDelta} onChangeText={(priceDelta) => patchRow(rowIndex, { priceDelta })} keyboardType="numbers-and-punctuation" />
            </View>
          </View>
          <Text style={styles.label}>{t("variants.editor.sku")}</Text>
          <TextInput style={styles.input} value={row.sku} onChangeText={(sku) => patchRow(rowIndex, { sku })} autoCapitalize="characters" autoCorrect={false} maxLength={40} />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t("variants.editor.visible")}</Text>
            <Switch value={row.isActive} onValueChange={(isActive) => patchRow(rowIndex, { isActive })} />
          </View>
          <Text style={styles.price}>{t("variants.editor.sellsAt", { price: formatXaf(rowPriceXaf(basePrice, row)) })}</Text>
          {(rowErrors[rowIndex] ?? []).map((message) => <Text key={message} style={styles.error}>{message}</Text>)}
        </View>
      ))}
      {draft.rows.length < MAX_VARIANTS && (
        <TouchableOpacity style={styles.secondary} onPress={() => edit(addRow(draft))}><Text style={styles.secondaryText}>{t("variants.editor.addVersion")}</Text></TouchableOpacity>
      )}

      <Text style={styles.total}>{t("variants.editor.total", { count: totalStock(draft) })}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.success}>{notice}</Text> : null}
      <TouchableOpacity style={[styles.primary, (saving || draft.rows.length === 0) && styles.disabled]} disabled={saving || draft.rows.length === 0} onPress={() => submit(draft, false)}>
        {saving ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.primaryText}>{t("variants.editor.save")}</Text>}
      </TouchableOpacity>
      {hadVariants && (
        <TouchableOpacity style={styles.dangerButton} disabled={saving} onPress={confirmRemoveAll}><Text style={styles.danger}>{t("variants.editor.removeAll")}</Text></TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  heading: { fontSize: 18, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  muted: { color: "#6B7280", fontSize: 13, marginBottom: 12 },
  section: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginTop: 12, marginBottom: 8 },
  nameRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  nameInput: { flex: 1 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, marginBottom: 8, fontSize: 14, backgroundColor: "#fff" },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 4 },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 },
  cardTitle: { flex: 1, fontWeight: "700", color: "#1B2A4A", fontSize: 14 },
  pair: { flexDirection: "row", gap: 8 },
  pairCell: { flex: 1 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44, gap: 8 },
  switchLabel: { flex: 1, fontSize: 14, color: "#374151" },
  price: { fontSize: 12, color: "#4B5563", marginTop: 2 },
  total: { fontSize: 14, fontWeight: "700", color: "#1B2A4A", marginTop: 12, marginBottom: 8 },
  error: { color: "#DC2626", fontSize: 13, marginTop: 4, marginBottom: 4 },
  success: { color: "#15803D", fontSize: 13, fontWeight: "600", marginBottom: 8 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, minHeight: 48, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryText: { color: "#1B2A4A", fontWeight: "700", fontSize: 15 },
  secondary: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, marginBottom: 8 },
  secondaryText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  dangerButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  danger: { color: "#B91C1C", fontWeight: "600", fontSize: 14 },
  disabled: { opacity: 0.5 },
});

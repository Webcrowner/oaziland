import { useCallback, useLayoutEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Image } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { getMyKycStatus, kycMissing, submitKyc, uploadMediaFile, type KycProfile, type KycSubmission } from "../lib/api";
import { useI18n } from "../i18n";
import LanguageToggle from "../components/LanguageToggle";

type Props = NativeStackScreenProps<RootStackParamList, "Kyc">;
type PhotoField = "id_document_front_image_url" | "id_document_back_image_url" | "selfie_image_url";

const EMPTY: KycSubmission = {
  legal_full_name: "", date_of_birth: "", national_id_number: "", residential_address: "",
  id_document_front_image_url: "", id_document_back_image_url: "", selfie_image_url: "",
};

/**
 * Identity verification (KYC) in the app, the same flow as the web /kyc page: personal details, both sides of
 * a photo ID, and a LIVE front-camera selfie (never a gallery photo, which could be an old picture of someone else).
 * Verification unlocks withdrawals and other checkouts.
 */
export default function KycScreen({ navigation }: Props) {
  const { t } = useI18n();
  useLayoutEffect(() => { navigation.setOptions({ title: t("kyc.title") }); }, [navigation, t]);
  const [kyc, setKyc] = useState<KycProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "signedOut">("loading");
  const [form, setForm] = useState<KycSubmission>(EMPTY);
  const [editing, setEditing] = useState(true);
  const [uploading, setUploading] = useState<PhotoField | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setState("loading");
    SecureStore.getItemAsync("access_token")
      .then((token) => {
        if (!token) {
          setState("signedOut");
          return null;
        }
        return getMyKycStatus().then((data) => {
          setKyc(data);
          if (data) {
            setForm({
              legal_full_name: data.legal_full_name, date_of_birth: data.date_of_birth, national_id_number: data.national_id_number,
              residential_address: data.residential_address, id_document_front_image_url: data.id_document_front_image_url || "",
              id_document_back_image_url: data.id_document_back_image_url || "", selfie_image_url: data.selfie_image_url || "",
            });
            // A submission under review stays closed; only a rejected one opens straight in the form.
            setEditing(data.kyc_status === "REJECTED");
          }
          setState("ready");
        });
      })
      .catch(() => setState("error"));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (field: keyof KycSubmission) => (value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  async function capture(field: PhotoField, source: "camera" | "library") {
    setError("");
    const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      setError(source === "camera" ? t("kyc.cameraPermission") : t("kyc.libraryPermission"));
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7 };
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ ...options, cameraType: field === "selfie_image_url" ? ImagePicker.CameraType.front : ImagePicker.CameraType.back })
      : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    setUploading(field);
    try {
      const uploaded = await uploadMediaFile(asset.uri, asset.mimeType || "image/jpeg", field === "selfie_image_url" ? "kyc-selfies" : "kyc-documents");
      setForm((prev) => ({ ...prev, [field]: uploaded.url }));
    } catch {
      setError(t("kyc.uploadFailed"));
    } finally {
      setUploading(null);
    }
  }

  async function handleSubmit() {
    const missing = kycMissing(form);
    if (missing.length > 0) {
      setError(t("kyc.pleaseAdd", { items: missing.map((field) => t(`kyc.missing.${field}`)).join(", ") }));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      setKyc(await submitKyc({ ...form, legal_full_name: form.legal_full_name.trim(), national_id_number: form.national_id_number.trim(), residential_address: form.residential_address.trim() }));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("kyc.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "loading") return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  if (state === "signedOut") {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t("kyc.signInPrompt")}</Text>
        <TouchableOpacity style={styles.primary} onPress={() => navigation.navigate("Login")}><Text style={styles.primaryText}>{t("common.signIn")}</Text></TouchableOpacity>
      </View>
    );
  }
  if (state === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t("kyc.loadFailed")}</Text>
        <TouchableOpacity style={styles.primary} onPress={load}><Text style={styles.primaryText}>{t("common.tryAgain")}</Text></TouchableOpacity>
      </View>
    );
  }

  const status = kyc?.kyc_status;
  const showForm = status !== "VERIFIED" && (!kyc || editing);
  const missing = kycMissing(form);

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <LanguageToggle />
      <Text style={styles.title}>{t("kyc.title")}</Text>
      <Text style={styles.subtitle}>{t("kyc.subtitle")}</Text>

      {status === "VERIFIED" && (
        <View style={[styles.banner, styles.bannerOk]}>
          <Text style={styles.bannerTitle}>{t("kyc.verifiedTitle")}</Text>
          <Text style={styles.bannerBody}>{t("kyc.verifiedBody")}</Text>
        </View>
      )}
      {status === "PENDING" && !editing && (
        <View style={[styles.banner, styles.bannerWait]}>
          <Text style={styles.bannerTitle}>{t("kyc.pendingTitle")}</Text>
          <Text style={styles.bannerBody}>{t("kyc.pendingBody")}</Text>
          <TouchableOpacity onPress={() => setEditing(true)}><Text style={styles.link}>{t("kyc.edit")}</Text></TouchableOpacity>
        </View>
      )}
      {status === "REJECTED" && (
        <View style={[styles.banner, styles.bannerBad]}>
          <Text style={styles.bannerTitle}>{t("kyc.rejectedTitle")}</Text>
          <Text style={styles.bannerBody}>{t("kyc.rejectedBody")}</Text>
        </View>
      )}

      {showForm && (
        <View>
          <Text style={styles.progress}>{t("kyc.progress", { done: 7 - missing.length, total: 7 })}</Text>

          <Text style={styles.step}>{t("kyc.stepDetails")}</Text>
          <TextInput style={styles.input} placeholder={t("kyc.namePlaceholder")} value={form.legal_full_name} onChangeText={set("legal_full_name")} autoComplete="name" />
          <TextInput style={styles.input} placeholder={t("kyc.dobPlaceholder")} value={form.date_of_birth} onChangeText={set("date_of_birth")} keyboardType="numbers-and-punctuation" maxLength={10} />
          <TextInput style={styles.input} placeholder={t("kyc.idNumberPlaceholder")} value={form.national_id_number} onChangeText={set("national_id_number")} autoCapitalize="characters" />
          <TextInput style={[styles.input, styles.multiline]} placeholder={t("kyc.addressPlaceholder")} value={form.residential_address} onChangeText={set("residential_address")} multiline />

          <Text style={styles.step}>{t("kyc.stepDocument")}</Text>
          <PhotoTile label={t("kyc.idFront")} url={form.id_document_front_image_url} busy={uploading === "id_document_front_image_url"}
            onCamera={() => capture("id_document_front_image_url", "camera")} onLibrary={() => capture("id_document_front_image_url", "library")} />
          <PhotoTile label={t("kyc.idBack")} url={form.id_document_back_image_url} busy={uploading === "id_document_back_image_url"}
            onCamera={() => capture("id_document_back_image_url", "camera")} onLibrary={() => capture("id_document_back_image_url", "library")} />

          <Text style={styles.step}>{t("kyc.stepSelfie")}</Text>
          <Text style={styles.hint}>{t("kyc.selfieHint")}</Text>
          <PhotoTile label={t("kyc.selfie")} url={form.selfie_image_url} busy={uploading === "selfie_image_url"} onCamera={() => capture("selfie_image_url", "camera")} />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={[styles.primary, (submitting || uploading !== null) && styles.disabled]} onPress={handleSubmit} disabled={submitting || uploading !== null}>
            {submitting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.primaryText}>{kyc ? t("kyc.resubmit") : t("kyc.submit")}</Text>}
          </TouchableOpacity>
          <Text style={styles.privacy}>{t("kyc.privacy")}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function PhotoTile({ label, url, busy, onCamera, onLibrary }: { label: string; url: string; busy: boolean; onCamera: () => void; onLibrary?: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.tile}>
      {url ? <Image source={{ uri: url }} style={styles.preview} /> : <View style={[styles.preview, styles.placeholder]}><Text style={styles.muted}>{label}</Text></View>}
      <View style={{ flex: 1 }}>
        <Text style={styles.tileLabel}>{label}{url ? "  ✓" : ""}</Text>
        {busy ? (
          <ActivityIndicator color="#1B2A4A" style={{ alignSelf: "flex-start", marginTop: 6 }} />
        ) : (
          <View style={styles.tileButtons}>
            <TouchableOpacity style={styles.tileButton} onPress={onCamera}><Text style={styles.tileButtonText}>{url ? t("kyc.retake") : t("kyc.takePhoto")}</Text></TouchableOpacity>
            {onLibrary && <TouchableOpacity style={styles.tileButton} onPress={onLibrary}><Text style={styles.tileButtonText}>{t("kyc.choose")}</Text></TouchableOpacity>}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 },
  container: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "800", color: "#1B2A4A" },
  subtitle: { fontSize: 13, color: "#6B7280", marginTop: 4, marginBottom: 14 },
  banner: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 14 },
  bannerOk: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  bannerWait: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  bannerBad: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  bannerTitle: { fontSize: 14, fontWeight: "800", color: "#111827" },
  bannerBody: { fontSize: 12, color: "#4B5563", marginTop: 2 },
  link: { fontSize: 13, color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline", marginTop: 8 },
  progress: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 6 },
  step: { fontSize: 14, fontWeight: "800", color: "#1B2A4A", marginTop: 12, marginBottom: 8 },
  hint: { fontSize: 12, color: "#6B7280", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 8 },
  multiline: { minHeight: 60, textAlignVertical: "top" },
  tile: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 10, marginBottom: 8 },
  preview: { width: 84, height: 64, borderRadius: 8, backgroundColor: "#F3F4F6" },
  placeholder: { alignItems: "center", justifyContent: "center" },
  tileLabel: { fontSize: 13, fontWeight: "700", color: "#111827" },
  tileButtons: { flexDirection: "row", gap: 6, marginTop: 6 },
  tileButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  tileButtonText: { fontSize: 12, fontWeight: "700", color: "#1B2A4A" },
  error: { fontSize: 12, color: "#B91C1C", backgroundColor: "#FEF2F2", borderRadius: 8, padding: 8, marginVertical: 8 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", marginTop: 8 },
  primaryText: { color: "#1B2A4A", fontWeight: "800" },
  disabled: { opacity: 0.5 },
  muted: { fontSize: 12, color: "#6B7280", textAlign: "center" },
  privacy: { fontSize: 11, color: "#9CA3AF", marginTop: 10, textAlign: "center" },
});

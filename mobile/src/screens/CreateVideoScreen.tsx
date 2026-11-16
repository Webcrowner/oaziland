import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { createPost, CreatePostError, uploadMediaFile } from "../lib/api";
import { MAX_VIDEO_CAPTION, videoDraftError, videoPostPayload } from "../lib/videos";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

type Props = NativeStackScreenProps<RootStackParamList, "CreateVideo">;
type Status = "idle" | "uploading" | "posting" | "posted" | "blocked" | "invalid" | "failed" | "uploadFailed";

/** Post a video: pick one from the phone, add a caption and tags, optionally tie it to one of your properties. */
export default function CreateVideoScreen({ route, navigation }: Props) {
  const { t } = useI18n();
  const linkedListingId = route.params?.linkedListingId;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [serverMessage, setServerMessage] = useState("");
  const [draftError, setDraftError] = useState<MessageKey | null>(null);

  useEffect(() => {
    if (status !== "posted") return;
    const timer = setTimeout(() => navigation.navigate("Videos"), 1000);
    return () => clearTimeout(timer);
  }, [status, navigation]);

  async function handlePick() {
    const { status: permission } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission !== "granted") {
      Alert.alert(t("videos.create.permissionTitle"), t("videos.create.permissionBody"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setStatus("uploading");
    setDraftError(null);
    try {
      const uploaded = await uploadMediaFile(asset.uri, asset.mimeType || "video/mp4", "videos");
      if (uploaded.media_type !== "VIDEO") throw new Error("not a video");
      setVideoUrl(uploaded.url);
      setStatus("idle");
    } catch {
      setStatus("uploadFailed");
    }
  }

  async function handlePublish() {
    if (status === "posting" || status === "posted" || status === "uploading") return;
    const problem = videoDraftError({ videoUrl, caption });
    if (problem) {
      setDraftError(`videos.error.${problem}` as MessageKey);
      return;
    }
    if (!(await SecureStore.getItemAsync("access_token"))) {
      Alert.alert(t("videos.create.signInTitle"), t("videos.create.signInBody"));
      return;
    }
    setStatus("posting");
    setServerMessage("");
    try {
      await createPost(videoPostPayload({ videoUrl: videoUrl as string, caption, tagsInput, linkedListingId }));
      setStatus("posted");
    } catch (err) {
      if (err instanceof CreatePostError && err.kind === "moderation") {
        setStatus("blocked");
      } else if (err instanceof CreatePostError && err.kind === "validation") {
        setServerMessage(err.message);
        setStatus("invalid");
      } else {
        setStatus("failed");
      }
    }
  }

  const busy = status === "posting" || status === "posted" || status === "uploading";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t("videos.create.title")}</Text>
      <Text style={styles.subtitle}>{t("videos.create.subtitle")}</Text>

      <View style={styles.picker}>
        <Text style={styles.pickerIcon}>🎬</Text>
        {videoUrl && <Text style={styles.ready}>✓ {t("videos.create.ready")}</Text>}
        <TouchableOpacity style={styles.pickButton} onPress={handlePick} disabled={busy}>
          {status === "uploading" ? <ActivityIndicator color="#fff" /> : <Text style={styles.pickButtonText}>{videoUrl ? t("videos.create.change") : t("videos.create.choose")}</Text>}
        </TouchableOpacity>
        <Text style={styles.hint}>{status === "uploading" ? t("videos.create.uploading") : t("videos.create.hint")}</Text>
      </View>

      <TextInput
        style={[styles.input, styles.textArea]} multiline numberOfLines={4} maxLength={MAX_VIDEO_CAPTION}
        placeholder={t("videos.create.caption")} value={caption} onChangeText={setCaption}
      />
      <Text style={styles.counter}>{caption.length}/{MAX_VIDEO_CAPTION}</Text>
      <TextInput style={styles.input} placeholder={t("videos.create.tags")} value={tagsInput} onChangeText={setTagsInput} autoCapitalize="none" />

      {linkedListingId && <Text style={styles.linked}>{t("videos.create.linked")}</Text>}

      {draftError && <Text style={styles.error}>{t(draftError)}</Text>}
      {status === "uploadFailed" && <Text style={styles.error}>{t("videos.create.uploadFailed")}</Text>}
      {status === "blocked" && <Text style={styles.error}>{t("videos.create.blocked")}</Text>}
      {status === "invalid" && <Text style={styles.error}>{serverMessage || t("videos.create.failed")}</Text>}
      {status === "failed" && <Text style={styles.error}>{t("videos.create.failed")}</Text>}
      {status === "posted" && <Text style={styles.success}>{t("videos.create.posted")}</Text>}

      <TouchableOpacity style={[styles.submit, busy && styles.disabled]} onPress={handlePublish} disabled={busy}>
        {status === "posting" ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitText}>{t("videos.create.publish")}</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20 },
  title: { fontSize: 20, fontWeight: "bold", color: "#1B2A4A", marginBottom: 4 },
  subtitle: { color: "#6B7280", fontSize: 13, marginBottom: 16 },
  picker: { borderWidth: 2, borderStyle: "dashed", borderColor: "#CBD5E1", backgroundColor: "#F8FAFC", borderRadius: 16, padding: 20, alignItems: "center", marginBottom: 16, gap: 8 },
  pickerIcon: { fontSize: 40 },
  ready: { color: "#15803D", fontWeight: "700" },
  pickButton: { backgroundColor: "#1B2A4A", borderRadius: 24, paddingHorizontal: 22, paddingVertical: 11, minWidth: 160, alignItems: "center" },
  pickButtonText: { color: "#fff", fontWeight: "700" },
  hint: { color: "#64748B", fontSize: 12 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 14 },
  textArea: { height: 100, textAlignVertical: "top", marginBottom: 2 },
  counter: { fontSize: 11, color: "#9CA3AF", textAlign: "right", marginBottom: 12 },
  linked: { fontSize: 12, backgroundColor: "#FBF3DC", color: "#8A6D14", padding: 10, borderRadius: 8, marginBottom: 12 },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 12 },
  success: { color: "#15803D", fontSize: 13, marginBottom: 12 },
  submit: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  submitText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
  disabled: { opacity: 0.5 },
});

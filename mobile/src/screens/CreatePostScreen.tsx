import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image, ScrollView, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { createPost, CreatePostError, uploadMediaFile, type MediaUploadResult } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "CreatePost">;
type Status = "idle" | "posting" | "posted" | "blocked" | "invalid" | "failed" | "uploadFailed";

const MAX_CAPTION_LENGTH = 2200;
const MAX_TAGS = 20;
const MAX_MEDIA = 10;

interface PendingMedia extends MediaUploadResult {
  localUri: string;
}

/**
 * Real post creation — photos and videos are uploaded via
 * /api/media/upload/ before the post itself is created, and the
 * server's own message is shown when a post is rejected (moderation
 * vs. validation vs. no connection are different problems).
 */
export default function CreatePostScreen({ route, navigation }: Props) {
  const linkedListingId = route.params?.linkedListingId;
  const [caption, setCaption] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [serverMessage, setServerMessage] = useState("");

  // The author's own posts are not in the main feed, so land on "My posts" to show the new post.
  useEffect(() => {
    if (status !== "posted") return;
    const timer = setTimeout(() => navigation.navigate("Feed", { tab: "mine" }), 1000);
    return () => clearTimeout(timer);
  }, [status, navigation]);

  async function uploadAndTrack(asset: ImagePicker.ImagePickerAsset) {
    setUploadingMedia(true);
    setStatus("idle");
    try {
      const mimeType = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
      const result = await uploadMediaFile(asset.uri, mimeType, "posts");
      setMedia((prev) => (prev.length >= MAX_MEDIA ? prev : [...prev, { ...result, localUri: asset.uri }]));
    } catch {
      setStatus("uploadFailed");
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handleAddMedia() {
    const { status: permissionStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionStatus !== "granted") {
      Alert.alert("Permission needed", "Allow access to your photos to attach media.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      await uploadAndTrack(result.assets[0]);
    }
  }

  async function handleSubmit() {
    if (status === "posting" || status === "posted") return;
    const token = await SecureStore.getItemAsync("access_token");
    if (!token) {
      Alert.alert("Sign in required", "Please sign in to create a post.");
      return;
    }
    const tags = [...new Set(tagsInput.split(",").map((tag) => tag.trim().replace(/^#+/, "").trim()).filter(Boolean))].slice(0, MAX_TAGS);
    setStatus("posting");
    setServerMessage("");
    try {
      await createPost({
        caption: caption.trim(),
        tags,
        linked_listing_id: linkedListingId,
        media_urls: media.map((m) => m.url),
      });
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

  const busy = status === "posting" || status === "posted";
  const canSubmit = !busy && !uploadingMedia && (caption.trim().length > 0 || media.length > 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Create a Post</Text>

      {linkedListingId && <Text style={styles.linkedNotice}>Linked to your listing</Text>}

      <TextInput
        style={[styles.input, styles.textArea]} multiline numberOfLines={4} maxLength={MAX_CAPTION_LENGTH}
        placeholder="Write a caption..." value={caption} onChangeText={setCaption}
      />
      <Text style={styles.counter}>{caption.length}/{MAX_CAPTION_LENGTH}</Text>
      <TextInput
        style={styles.input} placeholder="Tags (comma-separated, e.g. Bastos, ForRent)"
        value={tagsInput} onChangeText={setTagsInput}
      />

      {media.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaRow}>
          {media.map((m, i) => (
            <View key={m.url} style={styles.mediaItem}>
              {m.media_type === "VIDEO" ? (
                <View style={styles.videoBadge}>
                  <Text style={styles.videoBadgeText}>▶ Video</Text>
                </View>
              ) : (
                <Image source={{ uri: m.localUri }} style={styles.mediaThumb} />
              )}
              <TouchableOpacity style={styles.removeMedia} onPress={() => setMedia((prev) => prev.filter((_, idx) => idx !== i))} accessibilityLabel="Remove this file">
                <Text style={styles.removeMediaText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {media.length < MAX_MEDIA && (
        <TouchableOpacity style={styles.mediaButton} onPress={handleAddMedia} disabled={uploadingMedia}>
          {uploadingMedia ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.mediaButtonText}>Add Photo or Video</Text>}
        </TouchableOpacity>
      )}

      {status === "blocked" && <Text style={styles.errorText}>This post was blocked by content moderation. Please revise it and try again.</Text>}
      {status === "invalid" && <Text style={styles.errorText}>{serverMessage || "We couldn't publish your post. Please try again."}</Text>}
      {status === "failed" && <Text style={styles.errorText}>We couldn't publish your post. Check your connection and try again.</Text>}
      {status === "uploadFailed" && <Text style={styles.errorText}>That file couldn't be uploaded. Check its type and size and try again.</Text>}
      {status === "posted" && <Text style={styles.successText}>Posted!</Text>}

      <TouchableOpacity style={[styles.submitButton, !canSubmit && styles.disabled]} onPress={handleSubmit} disabled={!canSubmit}>
        {status === "posting" ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>Post</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20 },
  title: { fontSize: 20, fontWeight: "bold", color: "#1B2A4A", marginBottom: 16 },
  linkedNotice: { fontSize: 12, backgroundColor: "#FBF3DC", color: "#8A6D14", padding: 10, borderRadius: 8, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 14 },
  textArea: { height: 100, textAlignVertical: "top", marginBottom: 2 },
  counter: { fontSize: 11, color: "#9CA3AF", textAlign: "right", marginBottom: 12 },
  mediaRow: { marginBottom: 10 },
  mediaItem: { marginRight: 8 },
  mediaThumb: { width: 90, height: 90, borderRadius: 8 },
  videoBadge: { width: 90, height: 90, borderRadius: 8, backgroundColor: "#1B2A4A", justifyContent: "center", alignItems: "center" },
  videoBadgeText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  removeMedia: { position: "absolute", top: 0, right: 0, backgroundColor: "rgba(0,0,0,0.6)", borderTopRightRadius: 8, borderBottomLeftRadius: 8, paddingHorizontal: 8 },
  removeMediaText: { color: "#fff", fontSize: 16 },
  mediaButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 14 },
  mediaButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  errorText: { color: "#DC2626", fontSize: 13, marginBottom: 12 },
  successText: { color: "#15803D", fontSize: 13, marginBottom: 12 },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  submitButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
  disabled: { opacity: 0.5 },
});

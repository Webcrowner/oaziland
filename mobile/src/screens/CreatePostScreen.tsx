import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Image, ScrollView } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { createPost, uploadMediaFile, type MediaUploadResult } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "CreatePost">;

interface PendingMedia extends MediaUploadResult {
  localUri: string;
}

/**
 * Real post creation — a genuine gap this closes: this screen never
 * had ANY photo/video attachment capability at all, purely text
 * posts, despite Post/PostMedia supporting real media from the start.
 * Same real capture pattern now shared with ListPropertyScreen:
 * mediaTypes accepting both images and videos, genuinely uploaded via
 * /api/media/upload/ before the post itself is created.
 */
export default function CreatePostScreen({ route, navigation }: Props) {
  const linkedListingId = route.params?.linkedListingId;
  const [caption, setCaption] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [status, setStatus] = useState<"idle" | "posting" | "posted" | "blocked">("idle");

  async function uploadAndTrack(asset: ImagePicker.ImagePickerAsset) {
    setUploadingMedia(true);
    try {
      const mimeType = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
      const result = await uploadMediaFile(asset.uri, mimeType, "posts");
      setMedia((prev) => [...prev, { ...result, localUri: asset.uri }]);
    } catch {
      setStatus("blocked");
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handleAddMedia() {
    const { status: permissionStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionStatus !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      await uploadAndTrack(result.assets[0]);
    }
  }

  async function handleSubmit() {
    setStatus("posting");
    try {
      await createPost({
        caption,
        tags: tagsInput.split(",").map((tag) => tag.trim()).filter(Boolean),
        linked_listing_id: linkedListingId,
        media_urls: media.map((m) => m.url),
      });
      setStatus("posted");
      setTimeout(() => navigation.navigate("Feed"), 1000);
    } catch {
      setStatus("blocked");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create a Post</Text>

      {linkedListingId && <Text style={styles.linkedNotice}>Linked to your listing</Text>}

      <TextInput
        style={[styles.input, styles.textArea]} multiline numberOfLines={4}
        placeholder="Write a caption..." value={caption} onChangeText={setCaption}
      />
      <TextInput
        style={styles.input} placeholder="Tags (comma-separated, e.g. Bastos, ForRent)"
        value={tagsInput} onChangeText={setTagsInput}
      />

      {media.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaRow}>
          {media.map((m, i) => (
            m.media_type === "VIDEO" ? (
              <View key={i} style={styles.videoBadge}>
                <Text style={styles.videoBadgeText}>▶ Video</Text>
              </View>
            ) : (
              <Image key={i} source={{ uri: m.localUri }} style={styles.mediaThumb} />
            )
          ))}
        </ScrollView>
      )}

      <TouchableOpacity style={styles.mediaButton} onPress={handleAddMedia} disabled={uploadingMedia}>
        {uploadingMedia ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.mediaButtonText}>Add Photo or Video</Text>}
      </TouchableOpacity>

      {status === "blocked" && <Text style={styles.errorText}>This post was blocked by content moderation. Please revise it and try again.</Text>}
      {status === "posted" && <Text style={styles.successText}>Posted!</Text>}

      <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={status === "posting" || !caption.trim()}>
        {status === "posting" ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>Post</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 20 },
  title: { fontSize: 20, fontWeight: "bold", color: "#1B2A4A", marginBottom: 16 },
  linkedNotice: { fontSize: 12, backgroundColor: "#FBF3DC", color: "#8A6D14", padding: 10, borderRadius: 8, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 14 },
  textArea: { height: 100, textAlignVertical: "top" },
  mediaRow: { marginBottom: 10 },
  mediaThumb: { width: 90, height: 90, borderRadius: 8, marginRight: 8 },
  videoBadge: { width: 90, height: 90, borderRadius: 8, marginRight: 8, backgroundColor: "#1B2A4A", justifyContent: "center", alignItems: "center" },
  videoBadgeText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  mediaButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 14 },
  mediaButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  errorText: { color: "#DC2626", fontSize: 13, marginBottom: 12 },
  successText: { color: "#15803D", fontSize: 13, marginBottom: 12 },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  submitButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
});

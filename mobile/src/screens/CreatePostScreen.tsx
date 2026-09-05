import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { createPost } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "CreatePost">;

/**
 * Real post creation — reads an optional linkedListingId route param,
 * exactly what the real-estate-to-social CTA (built on the listing
 * detail screen) would link into, letting a landlord/agent/owner/
 * agency cross-promote their listing on the social side in one step.
 */
export default function CreatePostScreen({ route, navigation }: Props) {
  const linkedListingId = route.params?.linkedListingId;
  const [caption, setCaption] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [status, setStatus] = useState<"idle" | "posting" | "posted" | "blocked">("idle");

  async function handleSubmit() {
    setStatus("posting");
    try {
      await createPost({
        caption,
        tags: tagsInput.split(",").map((tag) => tag.trim()).filter(Boolean),
        linked_listing_id: linkedListingId,
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
  errorText: { color: "#DC2626", fontSize: 13, marginBottom: 12 },
  successText: { color: "#15803D", fontSize: 13, marginBottom: 12 },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  submitButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
});

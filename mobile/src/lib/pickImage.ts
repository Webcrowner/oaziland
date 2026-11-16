import * as ImagePicker from "expo-image-picker";
import { uploadMediaFile } from "./api";

/** Lets the user pick one photo from the library and uploads it; returns its URL, or null when they cancel or refuse access. */
export async function pickAndUploadPhoto(folder = "marketplace"): Promise<string | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") throw new Error("Allow access to your photos to add a picture.");
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const uploaded = await uploadMediaFile(asset.uri, asset.mimeType || "image/jpeg", folder);
  return uploaded.url;
}

export type PhotoSource = "camera" | "library";

/** Takes or picks one photo without uploading it anywhere yet (photo search sends it to its own endpoint); null when cancelled. */
export async function pickPhoto(source: PhotoSource): Promise<{ uri: string; mimeType: string | null } | null> {
  if (source === "camera") {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") throw new Error("Allow access to your camera to take a photo.");
  } else {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") throw new Error("Allow access to your photos to pick a picture.");
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6 };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;
  return { uri: result.assets[0].uri, mimeType: result.assets[0].mimeType ?? null };
}

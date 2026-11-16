/**
 * lib/pushNotifications.ts — push notifications on the phone (ride offers, trip updates, messages,
 * bookings...). The backend pushes every in-app notification to each registered device through Expo's
 * free push service.
 *
 * STATUS: permission, token and device registration are wired up. The one missing piece is the Expo (EAS)
 * project ID: run `eas init` in mobile/ (free Expo account), which adds it to app.json. Until then
 * getExpoPushTokenAsync() throws and the app runs without push.
 */
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { API_BASE_URL } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface PushRegistrationResult {
  token: string | null;
  error?: string;
}

export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    return { token: null, error: "Push notifications require a physical device, not a simulator." };
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    return { token: null, error: "Notification permission was not granted." };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  try {
    // Needs the app built with an Expo (EAS) project ID (expo.extra.eas.projectId in app.json, added by
    // `eas init`). Until then this throws and the app simply runs without push.
    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    return { token: tokenResponse.data };
  } catch {
    return {
      token: null,
      error: "Push notifications are not connected yet: the app needs an Expo project ID (run `eas init`).",
    };
  }
}

const REGISTERED_TOKEN_KEY = "expo_push_token";

/**
 * Registers this phone for the signed-in user's push notifications (ride offers, trip updates, messages).
 * Safe to call on every sign-in and app start: it does nothing when permission is refused or push isn't
 * connected yet.
 */
export async function registerDeviceForPush(): Promise<boolean> {
  const accessToken = await SecureStore.getItemAsync("access_token");
  if (!accessToken) return false;
  const { token } = await registerForPushNotificationsAsync();
  if (!token) return false;
  const res = await fetch(`${API_BASE_URL}/api/push/devices/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ platform: "EXPO", token }),
  });
  if (!res.ok) return false;
  await SecureStore.setItemAsync(REGISTERED_TOKEN_KEY, token);
  return true;
}

/** Stops pushes to this phone; call before signing out so the next person doesn't get them. */
export async function unregisterDeviceForPush(): Promise<void> {
  const token = await SecureStore.getItemAsync(REGISTERED_TOKEN_KEY);
  const accessToken = await SecureStore.getItemAsync("access_token");
  await SecureStore.deleteItemAsync(REGISTERED_TOKEN_KEY);
  if (!token || !accessToken) return;
  await fetch(`${API_BASE_URL}/api/push/devices/remove/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ token }),
  }).catch(() => {});
}

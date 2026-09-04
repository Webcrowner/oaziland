/**
 * lib/pushNotifications.ts — push notifications for booking
 * confirmations, price-drop alerts, and saved-search matches, per
 * Prompt 18's explicit requirement.
 *
 * HONEST STATUS: the permission-request and local-notification-display
 * code below is REAL and works today. What's NOT yet connected is a
 * real Firebase project — registerForPushNotificationsAsync() needs a
 * real Expo/Firebase project ID to get a genuine push token the
 * backend could send to. This is flagged the exact same way every
 * other not-yet-connected external service in this codebase is
 * flagged (payment gateways, moderation providers, OAuth) — the
 * founder needs to create that Firebase project before this goes from
 * "the code is ready" to "notifications actually arrive."
 */
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";

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
    // NOT YET CONNECTED: getExpoPushTokenAsync requires a real
    // projectId from app.json, which requires a real Expo/Firebase
    // project the founder hasn't created yet. This will throw until
    // that's set up — exactly the same "flag, don't fake" pattern
    // used throughout the backend.
    const tokenResponse = await Notifications.getExpoPushTokenAsync();
    return { token: tokenResponse.data };
  } catch {
    return {
      token: null,
      error: "Push notifications are not yet connected — this needs a real Firebase/Expo project ID, which hasn't been created yet.",
    };
  }
}

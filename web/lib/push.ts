import { API_BASE_URL } from "@/lib/api";

/**
 * Web Push for this browser: asks permission, subscribes through the service worker (public/sw.js) and
 * registers the subscription with the backend, which pushes every in-app notification to it.
 */

export type PushState = "unsupported" | "disabled" | "denied" | "off" | "on";

const STORED_ENDPOINT_KEY = "push_endpoint";

function supported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function getConfig(): Promise<{ web_push_enabled: boolean; web_push_public_key: string }> {
  const res = await fetch(`${API_BASE_URL}/api/push/config/`, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load push settings");
  return res.json();
}

/** Where this browser stands: whether push can work here, and whether it's switched on. */
export async function getPushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const config = await getConfig().catch(() => null);
  if (!config?.web_push_enabled) return "disabled";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

/** Must be called straight from a click, before anything else is awaited: browsers only show the
 * permission prompt in direct response to one. Only offer it when getPushState() said "off". */
export async function enablePush(accessToken: string): Promise<PushState> {
  if (!supported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const config = await getConfig();
  if (!config.web_push_enabled) return "disabled";

  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.web_push_public_key) }));
  const json = subscription.toJSON();
  const res = await fetch(`${API_BASE_URL}/api/push/devices/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ platform: "WEB", token: subscription.endpoint, web_p256dh: json.keys?.p256dh, web_auth: json.keys?.auth }),
  });
  if (!res.ok) throw new Error("Could not turn on notifications");
  localStorage.setItem(STORED_ENDPOINT_KEY, subscription.endpoint);
  return "on";
}

/** Stops notifications to this browser, e.g. on sign-out so the next person doesn't get them. */
export async function disablePush(accessToken: string | null): Promise<void> {
  const endpoint = localStorage.getItem(STORED_ENDPOINT_KEY);
  localStorage.removeItem(STORED_ENDPOINT_KEY);
  if (endpoint && accessToken) {
    await fetch(`${API_BASE_URL}/api/push/devices/remove/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token: endpoint }),
    }).catch(() => {});
  }
  if (!supported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe().catch(() => false);
}

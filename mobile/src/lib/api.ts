/**
 * lib/api.ts — the mobile app's API client, mirroring the web app's
 * lib/api.ts (Prompt 17) exactly in shape, so both clients talk to the
 * SAME Django API (Prompt 16) identically. On a physical device this
 * points at the real deployed API URL; during local development it
 * points at the machine running the Django server on the local network
 * (not localhost, since a phone/emulator is a separate device).
 */
import * as SecureStore from "expo-secure-store";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

export interface PropertyAssetSummary {
  id: string;
  type: string;
  size_sqm: string | null;
  finish_level: string;
  quarter: string;
  quarter_name: string;
  latitude: string | null;
  longitude: string | null;
  description: string;
}

export interface Listing {
  id: string;
  property_asset: PropertyAssetSummary;
  listing_type: string;
  status: string;
  price_xaf: string;
  published_at: string | null;
  lister_role: "OWNER" | "AGENT" | "AGENCY";
  lister_display_name: string;
  lister_agency_name: string | null;
  lister_id: string;
}

export interface PaginatedResponse<T> {
  count: number;
  results: T[];
}

export interface Quarter {
  id: string;
  name: string;
  village_name: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await SecureStore.getItemAsync("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function searchListings(params: {
  quarter?: string;
  property_type?: string;
  finish_level?: string;
  listing_type?: string;
}): Promise<PaginatedResponse<Listing>> {
  const query = new URLSearchParams();
  if (params.quarter) query.set("quarter", params.quarter);
  if (params.property_type) query.set("property_type", params.property_type);
  if (params.finish_level) query.set("finish_level", params.finish_level);
  if (params.listing_type) query.set("listing_type", params.listing_type);

  const res = await fetch(`${API_BASE_URL}/api/listings/?${query.toString()}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

export async function getListing(id: string): Promise<Listing> {
  const res = await fetch(`${API_BASE_URL}/api/listings/${id}/`);
  if (!res.ok) throw new Error(`Listing not found: ${res.status}`);
  return res.json();
}

export async function listQuarters(): Promise<Quarter[]> {
  const res = await fetch(`${API_BASE_URL}/api/quarters/`);
  if (!res.ok) throw new Error(`Failed to load quarters: ${res.status}`);
  const data: PaginatedResponse<Quarter> = await res.json();
  return data.results;
}

export async function registerUser(payload: { username: string; phone: string; password: string }) {
  const res = await fetch(`${API_BASE_URL}/api/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Registration failed");
  return res.json();
}

export async function loginUser(username: string, password: string): Promise<{ access: string; refresh: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Invalid username or password");
  const tokens = await res.json();
  // WHY SecureStore, not AsyncStorage: JWTs are credentials — SecureStore
  // uses the device's Keychain (iOS) / Keystore (Android) encrypted
  // storage, not plain-text storage AsyncStorage would use.
  await SecureStore.setItemAsync("access_token", tokens.access);
  await SecureStore.setItemAsync("refresh_token", tokens.refresh);
  return tokens;
}

export async function logout() {
  await SecureStore.deleteItemAsync("access_token");
  await SecureStore.deleteItemAsync("refresh_token");
}

export async function createListing(payload: { property_asset_id: string; listing_type: string; price_xaf: string }) {
  const res = await fetch(`${API_BASE_URL}/api/listings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  return res;
}

export interface HouseCreatePayload {
  quarter: string;
  size_sqm?: string;
  description?: string;
  finish_level?: string;
  bedrooms?: number;
  bathrooms?: number;
}

export async function createHouse(payload: HouseCreatePayload) {
  const res = await fetch(`${API_BASE_URL}/api/houses/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  return res;
}

// ---------------------------------------------------------------------------
// MFA setup/verify — mirrors the web app's real MFA flow (a critical
// fix earlier this session: these endpoints existed on the backend
// with no way to actually complete them on any client).
// ---------------------------------------------------------------------------
export async function setupMfa(mfaType: "SMS_OTP" | "EMAIL_OTP", destination: string) {
  const res = await fetch(`${API_BASE_URL}/api/auth/mfa/setup/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ mfa_type: mfaType, destination }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "MFA setup failed");
  return res.json();
}

export async function verifyMfa(challengeId: string, code: string) {
  const res = await fetch(`${API_BASE_URL}/api/auth/mfa/verify/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Incorrect or expired code");
  return res.json();
}

export async function getMfaStatus(): Promise<{ mfa_enabled: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/mfa/status/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not check MFA status");
  return res.json();
}

// ---------------------------------------------------------------------------
// Favorites — mirrors the web app's real favoriting flow.
// ---------------------------------------------------------------------------
export async function getMyFavorites(): Promise<{ listing_ids: string[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-favorites/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch favorites");
  return res.json();
}

export async function toggleFavoriteListing(listingId: string): Promise<{ is_favorited: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/listings/${listingId}/toggle-favorite/`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Could not update favorite");
  return res.json();
}

// ---------------------------------------------------------------------------
// Contact a lister via the real WhatsApp deep-link endpoint.
// ---------------------------------------------------------------------------
export async function contactListing(listingId: string): Promise<{ deep_link: string; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/listings/${listingId}/contact/`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error("Could not start the conversation");
  return res.json();
}

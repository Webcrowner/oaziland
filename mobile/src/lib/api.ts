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
}

export interface Listing {
  id: string;
  property_asset: PropertyAssetSummary;
  listing_type: string;
  status: string;
  price_xaf: string;
  published_at: string | null;
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
}): Promise<PaginatedResponse<Listing>> {
  const query = new URLSearchParams();
  if (params.quarter) query.set("quarter", params.quarter);
  if (params.property_type) query.set("property_type", params.property_type);
  if (params.finish_level) query.set("finish_level", params.finish_level);

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

export async function createListing(payload: { listing_type: string; price_xaf: string }) {
  const res = await fetch(`${API_BASE_URL}/api/listings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  return res;
}

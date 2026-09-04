/**
 * lib/api.ts — the ONE place that knows the Django API's base URL and
 * shape. Every page calls through here rather than hardcoding fetch()
 * calls with the URL scattered across the codebase — if the API moves
 * or a header requirement changes, this is the only file that changes.
 */

// Server Components (SSR) and the browser need different URLs in dev:
// SSR runs inside the Next.js server process and can reach the Django
// server directly; the browser needs a URL it can actually resolve.
// In production these would both point at the same real public API domain.
export const API_BASE_URL =
  typeof window === "undefined"
    ? process.env.API_INTERNAL_URL || "http://localhost:8000"
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface PropertyAssetSummary {
  id: string;
  type: string;
  size_sqm: string | null;
  finish_level: string;
  quarter: string;
  quarter_name: string;
  latitude: string | null;
  longitude: string | null;
}

export interface Listing {
  id: string;
  property_asset: PropertyAssetSummary;
  listing_type: string;
  status: string;
  price_xaf: string;
  published_at: string | null;
  created_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Quarter {
  id: string;
  name: string;
  village_name: string;
}

/** Searches listings — the exact endpoint Prompt 16 built and tested. */
export async function searchListings(params: {
  quarter?: string;
  property_type?: string;
  finish_level?: string;
}): Promise<PaginatedResponse<Listing>> {
  const query = new URLSearchParams();
  if (params.quarter) query.set("quarter", params.quarter);
  if (params.property_type) query.set("property_type", params.property_type);
  if (params.finish_level) query.set("finish_level", params.finish_level);

  const res = await fetch(`${API_BASE_URL}/api/listings/?${query.toString()}`, {
    // Server-rendered listing pages should always show fresh data —
    // this is what makes the SEO-critical pages actually SSR real
    // content rather than serving a stale cached snapshot.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

export async function getListing(id: string): Promise<Listing> {
  const res = await fetch(`${API_BASE_URL}/api/listings/${id}/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Listing not found: ${res.status}`);
  return res.json();
}

export async function listQuarters(): Promise<Quarter[]> {
  const res = await fetch(`${API_BASE_URL}/api/quarters/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load quarters: ${res.status}`);
  const data: PaginatedResponse<Quarter> = await res.json();
  return data.results;
}

export interface RoomTypeSummary {
  id: string;
  category: string;
  capacity: number;
  base_rate_xaf: string;
}

export interface Hotel {
  id: string;
  star_rating: number | null;
  verified: boolean;
  quarter: string;
  quarter_name: string;
  total_rooms: number;
  room_types: RoomTypeSummary[];
}

export async function searchHotels(): Promise<PaginatedResponse<Hotel>> {
  const res = await fetch(`${API_BASE_URL}/api/hotels/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hotel search failed: ${res.status}`);
  return res.json();
}

export async function registerUser(payload: {
  username: string;
  phone: string;
  password: string;
}): Promise<{ id: string }> {
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
  return res.json();
}

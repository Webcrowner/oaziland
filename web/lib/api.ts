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

// One shared refresh so several simultaneous 401s don't each burn the refresh token.
let refreshInFlight: Promise<string> | null = null;
function refreshOnce(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// Every call in this file tells the API which UI language is active, so
// server error messages can come back translated (see oaziland/error_translation.py).
// Any Bearer-authenticated call that hits a 401 (expired access token) is
// retried once with a refreshed token; if refresh fails the original 401 is returned.
function fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (typeof window === "undefined") return globalThis.fetch(input, init);
  const locale = window.location.pathname.split("/")[1];
  const headers = new Headers(init.headers);
  if ((locale === "fr" || locale === "en") && !headers.has("Accept-Language")) headers.set("Accept-Language", locale);
  return globalThis.fetch(input, { ...init, headers }).then(async (res) => {
    if (res.status !== 401 || !headers.get("Authorization")?.startsWith("Bearer ")) return res;
    try {
      const freshToken = await refreshOnce();
      const retryHeaders = new Headers(headers);
      retryHeaders.set("Authorization", `Bearer ${freshToken}`);
      return await globalThis.fetch(input, { ...init, headers: retryHeaders });
    } catch {
      return res;
    }
  });
}

// Access tokens are short-lived (1 hour) and nothing else in this file
// auto-refreshes them yet — this is the one place that does, used by
// the chat widget so an expired token mid-conversation doesn't dead-end
// with a raw "Given token not valid for any token type" error.
export async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) throw new Error("Your session has expired — please sign in again.");

  const res = await fetch(`${API_BASE_URL}/api/auth/login/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: refreshToken }),
  });
  if (!res.ok) throw new Error("Your session has expired — please sign in again.");

  const data = await res.json();
  localStorage.setItem("access_token", data.access);
  return data.access;
}

async function fetchWithAutoRefresh(url: string, init: RequestInit, accessToken: string): Promise<Response> {
  const authHeaders = (token: string) => ({ ...init.headers, Authorization: `Bearer ${token}` });

  let res = await fetch(url, { ...init, headers: authHeaders(accessToken) });
  if (res.status === 401) {
    const freshToken = await refreshAccessToken();
    res = await fetch(url, { ...init, headers: authHeaders(freshToken) });
  }
  return res;
}

export interface UserProfile {
  id: string;
  username: string;
  phone: string;
  email: string;
  full_name: string;
  preferred_language: string;
  profile_image_url: string;
  verification_status: string;
  account_status: string;
  is_admin: boolean;
  is_agent: boolean;
  is_landlord: boolean;
  is_student: boolean;
  is_technician: boolean;
  is_driver: boolean;
}

export async function getMyProfile(accessToken: string): Promise<UserProfile> {
  const res = await fetch(`${API_BASE_URL}/api/auth/me/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  return res.json();
}

// TEMPORARY dev-only: backend answers 404 unless DEBUG is on.
export async function devSwitchRole(role: string, accessToken: string): Promise<UserProfile> {
  const res = await fetchWithAutoRefresh(
    `${API_BASE_URL}/api/auth/dev-switch-role/`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) },
    accessToken
  );
  if (!res.ok) throw new Error(res.status === 404 ? "Backend DEBUG is off." : `Role switch failed (${res.status}).`);
  return res.json();
}

export async function updateMyProfile(
  payload: Partial<{ username: string; phone: string; email: string; preferred_language: string; profile_image_url: string }>,
  accessToken: string
): Promise<UserProfile> {
  const res = await fetch(`${API_BASE_URL}/api/auth/me/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not update profile");
  return data;
}

export interface KycProfile {
  legal_full_name: string;
  date_of_birth: string;
  national_id_number: string;
  id_document_front_image_url: string;
  id_document_back_image_url: string;
  selfie_image_url: string;
  residential_address: string;
  kyc_status: "PENDING" | "VERIFIED" | "REJECTED";
  submitted_at: string;
  reviewed_at: string | null;
}

export async function getMyKycStatus(accessToken: string): Promise<KycProfile | null> {
  const res = await fetch(`${API_BASE_URL}/api/auth/kyc/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not fetch KYC status");
  return res.json();
}

export async function submitKyc(
  payload: {
    legal_full_name: string; date_of_birth: string; national_id_number: string; residential_address: string;
    id_document_front_image_url: string; id_document_back_image_url: string; selfie_image_url: string;
  },
  accessToken: string
): Promise<KycProfile> {
  const res = await fetch(`${API_BASE_URL}/api/auth/kyc/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not submit KYC");
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/auth/change-password/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not change password");
  return data;
}

export async function requestPasswordReset(username: string) {
  const res = await fetch(`${API_BASE_URL}/api/auth/password-reset/request/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not request password reset");
  return data;
}

export async function confirmPasswordReset(token: string, newPassword: string) {
  const res = await fetch(`${API_BASE_URL}/api/auth/password-reset/confirm/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not reset password");
  return data;
}

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
  amenities: string[];
  house_rules: string[];
  nearby_facility_names: string[];
  bedrooms: number | null;
  bathrooms: number | null;
  living_rooms: number | null;
  house_style: string | null;
  has_garage: boolean | null;
  pets_allowed: boolean | null;
}

export interface ListingPhotoItem {
  id: number;
  url: string;
  media_type: "PHOTO" | "VIDEO";
  is_primary: boolean;
}

export interface Listing {
  id: string;
  property_asset: PropertyAssetSummary;
  listing_type: string;
  status: string;
  price_xaf: string;
  published_at: string | null;
  expires_at?: string | null;
  created_at: string;
  lister_role: "OWNER" | "AGENT" | "AGENCY";
  lister_display_name: string;
  lister_agency_name: string | null;
  lister_id: string;
  lister_average_rating?: number | null;
  lister_rating_count?: number;
  photos: ListingPhotoItem[];
}

export interface MediaUploadResult {
  url: string;
  media_type: "PHOTO" | "VIDEO";
}

// Mirrors the backend's upload rules (uploads/services.py) so problems surface before a long upload.
const UPLOAD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const UPLOAD_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const UPLOAD_IMAGE_LIMIT_MB = 10;
const UPLOAD_VIDEO_LIMIT_MB = 100;

export type MediaFileProblem = { code: "unsupported" } | { code: "tooLarge"; sizeMb: number; limitMb: number };

export function checkMediaFile(file: File): MediaFileProblem | null {
  const isImage = UPLOAD_IMAGE_TYPES.includes(file.type);
  const isVideo = UPLOAD_VIDEO_TYPES.includes(file.type);
  if (!isImage && !isVideo) return { code: "unsupported" };
  const limitMb = isImage ? UPLOAD_IMAGE_LIMIT_MB : UPLOAD_VIDEO_LIMIT_MB;
  if (file.size > limitMb * 1024 * 1024) return { code: "tooLarge", sizeMb: Math.ceil(file.size / 1024 / 1024), limitMb };
  return null;
}

/** Uploads one file via XMLHttpRequest (fetch can't report upload progress); `signal` cancels it. */
export function uploadMediaFile(
  file: File,
  folder: string,
  accessToken: string,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {}
): Promise<MediaUploadResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", folder);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/api/media/upload/`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) options.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: { detail?: string } & Partial<MediaUploadResult> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error body (e.g. a proxy page) — fall through to the generic message
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as MediaUploadResult);
      else reject(new Error(data.detail || "Upload failed"));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
}

export async function addListingPhoto(listingId: string, url: string, mediaType: "PHOTO" | "VIDEO", accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/listings/${listingId}/add-photo/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url, media_type: mediaType }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not attach media");
  return res.json();
}

const PROPERTY_TYPE_ENDPOINTS: Record<string, string> = { HOUSE: "houses", SHOP: "shops", LAND: "lands" };

export async function setPropertyAmenities(propertyType: string, propertyId: string, amenities: string[], accessToken: string) {
  const endpoint = PROPERTY_TYPE_ENDPOINTS[propertyType] || "houses";
  const res = await fetch(`${API_BASE_URL}/api/${endpoint}/${propertyId}/set-amenities/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ amenities }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not set amenities");
  return res.json();
}

export async function setPropertyHouseRules(propertyType: string, propertyId: string, houseRules: string[], accessToken: string) {
  const endpoint = PROPERTY_TYPE_ENDPOINTS[propertyType] || "houses";
  const res = await fetch(`${API_BASE_URL}/api/${endpoint}/${propertyId}/set-house-rules/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ house_rules: houseRules }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not set house rules");
  return res.json();
}

// ---------------------------------------------------------------------------
// Points of interest (real nearby facilities) and listing conditions —
// both had real backend logic with zero API reaching them until now.
// ---------------------------------------------------------------------------
export interface PointOfInterest {
  id: string;
  name: string;
  poi_type: string;
  poi_type_display: string;
  quarter: string;
}

export async function listPointsOfInterest(quarterId: string): Promise<PointOfInterest[]> {
  const res = await fetch(`${API_BASE_URL}/api/points-of-interest/?quarter=${quarterId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || data;
}

export async function setNearbyFacilities(propertyType: string, propertyId: string, pointOfInterestIds: string[], accessToken: string) {
  const endpoint = PROPERTY_TYPE_ENDPOINTS[propertyType] || "houses";
  const res = await fetch(`${API_BASE_URL}/api/${endpoint}/${propertyId}/set-nearby-facilities/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ point_of_interest_ids: pointOfInterestIds }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not set nearby facilities");
  return res.json();
}

export interface ListingConditionItem {
  id: string;
  structured_conditions: Record<string, unknown>;
  free_text_clause: string;
}

export async function getListingConditions(targetContentType: string, targetId: string): Promise<ListingConditionItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/listing-conditions/?target_content_type=${targetContentType}&target_id=${targetId}`);
  if (!res.ok) return [];
  return res.json();
}

export async function attachListingCondition(
  payload: { target_content_type: string; target_id: string; structured_conditions: Record<string, unknown>; free_text_clause: string },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/listing-conditions/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not set listing conditions");
  return res.json();
}

export interface HouseCreatePayload {
  quarter: string;
  size_sqm?: string;
  description?: string;
  finish_level?: string;
  bedrooms?: number;
  bathrooms?: number;
  living_rooms?: number;
  house_style?: string;
  custom_house_style?: string;
  latitude?: number | string;
  longitude?: number | string;
}

export async function createHouse(payload: HouseCreatePayload, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/houses/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  return res;
}

export interface ShopCreatePayload {
  quarter: string;
  size_sqm?: string;
  description?: string;
  finish_level?: string;
  frontage_meters?: string;
  latitude?: number | string;
  longitude?: number | string;
}

export async function createShop(payload: ShopCreatePayload, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/shops/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  return res;
}

export interface LandCreatePayload {
  quarter: string;
  size_sqm?: string;
  description?: string;
  land_use_type: string;
  title_deed_number: string;
  title_type: string;
  bornes_visibles?: boolean;
  latitude?: number | string;
  longitude?: number | string;
}

export async function createLand(payload: LandCreatePayload, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/lands/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  return res;
}

export async function createListing(payload: { property_asset_id: string; listing_type: string; price_xaf: string }, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/listings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  return res;
}

export async function contactListing(listingId: string, accessToken: string): Promise<{ deep_link: string; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/listings/${listingId}/contact/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Contact request failed: ${res.status}`);
  return res.json();
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
  region_name?: string;
}

/** Searches listings — the exact endpoint Prompt 16 built and tested. */
export async function searchListings(params: {
  quarter?: string;
  property_type?: string;
  finish_level?: string;
  listing_type?: string;
  ordering?: string;
  max_price?: string;
  page?: string;
}): Promise<PaginatedResponse<Listing>> {
  const query = new URLSearchParams();
  if (params.quarter) query.set("quarter", params.quarter);
  if (params.property_type) query.set("property_type", params.property_type);
  if (params.finish_level) query.set("finish_level", params.finish_level);
  if (params.listing_type) query.set("listing_type", params.listing_type);
  if (params.ordering) query.set("ordering", params.ordering);
  if (params.max_price) query.set("max_price", params.max_price);
  if (params.page) query.set("page", params.page);

  const res = await fetch(`${API_BASE_URL}/api/listings/?${query.toString()}`, {
    // Server-rendered listing pages should always show fresh data —
    // this is what makes the SEO-critical pages actually SSR real
    // content rather than serving a stale cached snapshot.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

export interface ListingEditPayload {
  price_xaf?: string;
  listing_type?: string;
  description?: string;
  size_sqm?: string | null;
  finish_level?: string;
  latitude?: number | null;
  longitude?: number | null;
  amenities?: string[];
  bedrooms?: number;
  bathrooms?: number;
  living_rooms?: number;
  house_style?: string;
  has_garage?: boolean;
  pets_allowed?: boolean;
}

export async function editListingDetails(id: string, payload: ListingEditPayload, accessToken: string): Promise<Listing> {
  const res = await fetch(`${API_BASE_URL}/api/listings/${id}/edit-details/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || Object.values(data).flat().join(" ") || "Could not save changes");
  return data;
}

export async function renewListing(id: string, accessToken: string): Promise<Listing> {
  const res = await fetch(`${API_BASE_URL}/api/listings/${id}/renew/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not renew the listing");
  return data;
}

/** Every listing the caller posted, in every status (the public search only shows published ones). */
export async function listMyListings(accessToken: string, status?: string, page = 1): Promise<PaginatedResponse<Listing>> {
  const query = new URLSearchParams({ page: String(page) });
  if (status) query.set("status", status);
  const res = await fetchWithAutoRefresh(`${API_BASE_URL}/api/my-listings/?${query.toString()}`, {}, accessToken);
  if (!res.ok) throw new Error("Could not load your listings");
  return res.json();
}

export async function setListingStatus(id: string, status: string, accessToken: string): Promise<Listing> {
  const res = await fetchWithAutoRefresh(
    `${API_BASE_URL}/api/listings/${id}/set-status/`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) },
    accessToken
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not update the listing");
  return data;
}

export async function deleteListing(id: string, accessToken: string): Promise<void> {
  const res = await fetchWithAutoRefresh(`${API_BASE_URL}/api/listings/${id}/`, { method: "DELETE" }, accessToken);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Could not delete the listing");
  }
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

/** Asks admins to add a neighbourhood missing from the dropdown (never creates one directly). */
export async function suggestMissingArea(
  payload: { region_name: string; city_name: string; area_name: string },
  accessToken: string
): Promise<void> {
  const res = await fetchWithAutoRefresh(
    `${API_BASE_URL}/api/area-suggestions/`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    accessToken
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = Object.values(data).flat().join(" ");
    throw new Error(message || "Could not send your request");
  }
}

// ---------------------------------------------------------------------------
// Finance — real property valuation and rent-affordability tools. The
// real gap this closes: estimate_property_value() and
// estimate_affordable_rent_range() had real, working logic and even
// a real model to store valuation results in, but no page anywhere
// ever exposed either one. Public: neither requires an account,
// matching how every other browse/search surface on the platform works.
// ---------------------------------------------------------------------------
export interface ValuationEstimateResult {
  id: string;
  quarter: string;
  quarter_name: string;
  property_type: string;
  estimated_low_xaf: string;
  estimated_high_xaf: string;
  comparable_count: number;
  created_at: string;
}

export async function estimatePropertyValue(quarterId: string, propertyType: string): Promise<ValuationEstimateResult> {
  const res = await fetch(`${API_BASE_URL}/api/valuations/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quarter: quarterId, property_type: propertyType }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not estimate value");
  return data;
}

export interface AffordabilityResult {
  comfortable_rent_xaf: string;
  max_recommended_rent_xaf: string;
}

export async function estimateAffordability(monthlyIncomeXaf: string): Promise<AffordabilityResult> {
  const res = await fetch(`${API_BASE_URL}/api/affordability/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monthly_income_xaf: monthlyIncomeXaf }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not estimate affordability");
  return data;
}

export interface EarningsReportResult {
  period: { start: string; end: string };
  total_commission_earned_xaf: string;
  total_payouts_received_xaf: string;
  transaction_count: number;
}

export async function getMyEarningsReport(startDate: string, endDate: string, accessToken: string): Promise<EarningsReportResult> {
  const res = await fetch(`${API_BASE_URL}/api/my-earnings-report/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ start_date: startDate, end_date: endDate }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not generate earnings report");
  return data;
}

export async function convertCurrency(amountXaf: string, currencyCode: string): Promise<{ amount_xaf: string; currency_code: string; converted_amount: string }> {
  const res = await fetch(`${API_BASE_URL}/api/currency-conversion/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount_xaf: amountXaf, currency_code: currencyCode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "No exchange rate available for that currency");
  return data;
}

export interface RoomTypeSummary {
  id: string;
  category: string;
  capacity: number;
  base_rate_xaf: string;
  amenities?: string[];
}

export interface Hotel {
  id: string;
  lister_role?: "OWNER" | "AGENT" | "AGENCY";
  lister_average_rating?: number | null;
  lister_rating_count?: number;
  owner: string;
  owner_name?: string | null;
  name?: string;
  star_rating: number | null;
  verified: boolean;
  quarter: string;
  quarter_name: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  total_rooms: number;
  room_types: RoomTypeSummary[];
  photos: PropertyAssetPhotoItem[];
  description?: string;
  amenities?: string[];
}

export interface PropertyAssetPhotoItem {
  id: number;
  url: string;
  media_type: "PHOTO" | "VIDEO";
  is_primary: boolean;
}

export async function searchHotels(): Promise<PaginatedResponse<Hotel>> {
  const res = await fetch(`${API_BASE_URL}/api/hotels/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hotel search failed: ${res.status}`);
  return res.json();
}

export async function verifyHotel(hotelId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/hotels/${hotelId}/verify/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res;
}

export async function listHotelsForAdmin(accessToken: string): Promise<PaginatedResponse<Hotel>> {
  const res = await fetch(`${API_BASE_URL}/api/hotels/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Hotel fetch failed: ${res.status}`);
  return res.json();
}

/** Same endpoint as listHotelsForAdmin — for a non-admin owner this
 * returns every verified hotel plus their own (verified or not), so
 * the caller must still filter by owner === profile.id client-side. */
export async function listMyHotels(accessToken: string): Promise<PaginatedResponse<Hotel>> {
  const res = await fetch(`${API_BASE_URL}/api/hotels/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Hotel fetch failed: ${res.status}`);
  return res.json();
}

export interface HotelFinancialDashboard {
  total_bookings: number;
  bookings_trend: PeriodTrend;
  revenue_trend_xaf: PeriodTrend;
  top_room_types_by_revenue: { group: string; total: number }[];
  outstanding_balance_xaf: string;
  escrow_status_breakdown: Record<string, number>;
}

export async function getHotelFinancialDashboard(hotelId: string, accessToken: string): Promise<HotelFinancialDashboard> {
  const res = await fetch(`${API_BASE_URL}/api/hotels/${hotelId}/financial-dashboard/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error((await res.json()).detail || `Hotel financial dashboard fetch failed: ${res.status}`);
  return res.json();
}

export async function createHotel(
  payload: {
    quarter: string;
    name?: string;
    star_rating?: number;
    latitude?: number | string;
    longitude?: number | string;
    room_types: { category: string; capacity: number; base_rate_xaf: string }[];
  },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/hotels/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function setHotelLocation(hotelId: string, latitude: number, longitude: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/hotels/${hotelId}/set-location/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ latitude, longitude }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not update hotel location");
  return res.json();
}

export async function addHotelPhoto(hotelId: string, url: string, mediaType: "PHOTO" | "VIDEO", accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/hotels/${hotelId}/add-photo/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url, media_type: mediaType }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not attach photo");
  return res.json();
}

export interface Reservation {
  id: string;
  hotel: string;
  room_type: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  rate_xaf: string;
  status: string;
  special_requests: string;
  created_at: string;
}

export async function createReservation(
  payload: { room_type: string; check_in: string; check_out: string; adults: number; children?: number; special_requests?: string },
  accessToken: string
): Promise<Reservation> {
  const res = await fetch(`${API_BASE_URL}/api/reservations/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

export interface VenueSpaceSummary {
  id: string;
  space_name: string;
  capacity_theatre: number | null;
  capacity_banquet: number | null;
  capacity_cocktail?: number | null;
  capacity_classroom?: number | null;
  catering_policy?: string;
  base_price_per_hour_xaf: string;
}

export interface Venue {
  id: string;
  lister_role?: "OWNER" | "AGENT" | "AGENCY";
  lister_average_rating?: number | null;
  lister_rating_count?: number;
  owner: string;
  owner_name?: string | null;
  verified: boolean;
  quarter: string;
  quarter_name: string;
  spaces: VenueSpaceSummary[];
  photos: PropertyAssetPhotoItem[];
  latitude?: string | number | null;
  longitude?: string | number | null;
  description?: string;
  amenities?: string[];
}

export async function searchVenues(): Promise<PaginatedResponse<Venue>> {
  const res = await fetch(`${API_BASE_URL}/api/venues/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Venue search failed: ${res.status}`);
  return res.json();
}

export async function verifyVenue(venueId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/venues/${venueId}/verify/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res;
}

export async function listVenuesForAdmin(accessToken: string): Promise<PaginatedResponse<Venue>> {
  const res = await fetch(`${API_BASE_URL}/api/venues/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Venue fetch failed: ${res.status}`);
  return res.json();
}

/** Same endpoint as listVenuesForAdmin — for a non-admin owner this
 * returns every verified venue plus their own (verified or not), so
 * the caller must still filter by owner === profile.id client-side. */
export async function listMyVenues(accessToken: string): Promise<PaginatedResponse<Venue>> {
  const res = await fetch(`${API_BASE_URL}/api/venues/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Venue fetch failed: ${res.status}`);
  return res.json();
}

export interface VenueFinancialDashboard {
  total_bookings: number;
  bookings_trend: PeriodTrend;
  revenue_trend_xaf: PeriodTrend;
  top_event_types_by_revenue: { group: string; total: number }[];
  outstanding_balance_xaf: string;
  escrow_status_breakdown: Record<string, number>;
}

export async function getVenueFinancialDashboard(venueId: string, accessToken: string): Promise<VenueFinancialDashboard> {
  const res = await fetch(`${API_BASE_URL}/api/venues/${venueId}/financial-dashboard/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error((await res.json()).detail || `Venue financial dashboard fetch failed: ${res.status}`);
  return res.json();
}

export async function createVenue(
  payload: {
    quarter: string;
    latitude?: number | string;
    longitude?: number | string;
    spaces: { space_name: string; capacity_theatre?: number; capacity_banquet?: number; base_price_per_hour_xaf?: string }[];
  },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/venues/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function setVenueLocation(venueId: string, latitude: number, longitude: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/venues/${venueId}/set-location/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ latitude, longitude }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not update venue location");
  return res.json();
}

export async function addVenuePhoto(venueId: string, url: string, mediaType: "PHOTO" | "VIDEO", accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/venues/${venueId}/add-photo/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url, media_type: mediaType }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not attach photo");
  return res.json();
}

export interface EventBooking {
  id: string;
  venue_space: string;
  event_type: string;
  event_date: string;
  start_time: string;
  end_time: string;
  guest_count: number;
  layout_preference: string;
  catering_required: boolean;
  av_needs: string;
  special_requests: string;
  status: string;
  total_cost_xaf: string;
  package_tier: string;
  deposit_amount_xaf: string;
  balance_amount_xaf: string;
  created_at: string;
}

export async function createEventBooking(
  payload: {
    venue_space: string;
    event_type: string;
    event_date: string;
    start_time: string;
    end_time: string;
    guest_count: number;
    layout_preference?: string;
    catering_required?: boolean;
    av_needs?: string;
    special_requests?: string;
  },
  accessToken: string
): Promise<EventBooking> {
  const res = await fetch(`${API_BASE_URL}/api/event-bookings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

export interface HostelUnitSummary {
  id: string;
  room_code: string;
  unit_type: string;
  occupancy_model: string;
  amenity_tier: string;
  bed_capacity: number | null;
}

export interface StudentHostel {
  id: string;
  lister_role?: "OWNER" | "AGENT" | "AGENCY";
  lister_average_rating?: number | null;
  lister_rating_count?: number;
  owner?: string;
  owner_name?: string | null;
  property_type: string;
  quarter: string;
  quarter_name: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  units: HostelUnitSummary[];
  photos: PropertyAssetPhotoItem[];
  description?: string;
  amenities?: string[];
}

export async function searchStudentHostels(): Promise<PaginatedResponse<StudentHostel>> {
  const res = await fetch(`${API_BASE_URL}/api/student-hostels/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Student hostel search failed: ${res.status}`);
  return res.json();
}

export async function createStudentHostel(
  payload: { quarter: string; property_type?: string; latitude?: number | string; longitude?: number | string },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/student-hostels/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function setHostelLocation(hostelId: string, latitude: number, longitude: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/student-hostels/${hostelId}/set-location/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ latitude, longitude }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not update hostel location");
  return res.json();
}

export async function addStudentHostelPhoto(hostelId: string, url: string, mediaType: "PHOTO" | "VIDEO", accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/student-hostels/${hostelId}/add-photo/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url, media_type: mediaType }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not attach photo");
  return res.json();
}

export interface GuestHouse {
  id: string;
  lister_role?: "OWNER" | "AGENT" | "AGENCY";
  lister_average_rating?: number | null;
  lister_rating_count?: number;
  owner?: string;
  owner_name?: string | null;
  is_coastal_leisure: boolean;
  quarter: string;
  quarter_name: string;
  finish_level: string;
  amenities: string[];
  photos: PropertyAssetPhotoItem[];
  latitude?: string | number | null;
  longitude?: string | number | null;
  description?: string;
}

async function getAssetById<T>(path: string, id: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/${path}/${id}/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Not found: ${res.status}`);
  return res.json();
}

export const getHotel = (id: string) => getAssetById<Hotel>("hotels", id);
export const getVenue = (id: string) => getAssetById<Venue>("venues", id);
export const getGuestHouse = (id: string) => getAssetById<GuestHouse>("guest-houses", id);
export const getStudentHostel = (id: string) => getAssetById<StudentHostel>("student-hostels", id);

export type AssetMediaEndpoint = "listings" | "hotels" | "venues" | "guest-houses" | "student-hostels" | MarketplaceCategory;

const isMarketplaceEndpoint = (endpoint: AssetMediaEndpoint) => endpoint in MARKETPLACE_ENDPOINTS;

export async function addAssetMedia(endpoint: AssetMediaEndpoint, id: string, url: string, mediaType: "PHOTO" | "VIDEO", accessToken: string) {
  const action = isMarketplaceEndpoint(endpoint) ? "add-media" : "add-photo";
  const res = await fetch(`${API_BASE_URL}/api/${endpoint}/${id}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url, media_type: mediaType }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Could not attach media");
  return res.json();
}

export async function removeAssetMedia(endpoint: AssetMediaEndpoint, id: string, photoId: number, accessToken: string) {
  const marketplace = isMarketplaceEndpoint(endpoint);
  const res = await fetch(`${API_BASE_URL}/api/${endpoint}/${id}/${marketplace ? "remove-media" : "remove-photo"}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(marketplace ? { media_id: photoId } : { photo_id: photoId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Could not remove media");
}

export async function searchGuestHouses(): Promise<PaginatedResponse<GuestHouse>> {
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Guest house search failed: ${res.status}`);
  return res.json();
}

export async function createGuestHouse(
  payload: {
    quarter: string;
    is_coastal_leisure?: boolean;
    finish_level?: string;
    latitude?: number | string;
    longitude?: number | string;
  },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function setGuestHouseLocation(guestHouseId: string, latitude: number, longitude: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/${guestHouseId}/set-location/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ latitude, longitude }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not update guest house location");
  return res.json();
}

export async function addGuestHousePhoto(guestHouseId: string, url: string, mediaType: "PHOTO" | "VIDEO", accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/${guestHouseId}/add-photo/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url, media_type: mediaType }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not attach photo");
  return res.json();
}

export interface GuestHouseHostDashboard {
  total_guest_houses: number;
  total_blocked_nights_all_channels: number;
  pending_housekeeping_tasks: number;
  booked_nights_trend: PeriodTrend;
}

export async function getMyGuestHouseHostDashboard(accessToken: string): Promise<GuestHouseHostDashboard> {
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/my-dashboard/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Host dashboard fetch failed: ${res.status}`);
  return res.json();
}

export interface WantedListingResponseItem {
  id: string;
  responder: string;
  message: string;
  created_at: string;
}

export interface WantedListing {
  id: string;
  category: string;
  quarter: string | null;
  quarter_name: string | null;
  min_size_sqm: string | null;
  max_budget_xaf: string | null;
  notes: string;
  status: string;
  created_at: string;
  responses: WantedListingResponseItem[];
}

export async function listWantedListings(): Promise<PaginatedResponse<WantedListing>> {
  const res = await fetch(`${API_BASE_URL}/api/wanted-listings/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Wanted-listing fetch failed: ${res.status}`);
  return res.json();
}

export async function createWantedListing(
  data: {
    category: string;
    quarter?: string;
    min_size_sqm?: number;
    max_budget_xaf?: number | string;
    notes: string;
  },
  accessToken: string
): Promise<WantedListing> {
  const res = await fetch(`${API_BASE_URL}/api/wanted-listings/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || "Failed to create wanted listing");
  return json;
}

export async function respondToWantedListing(
  wantedListingId: string,
  message: string,
  accessToken: string
): Promise<WantedListingResponseItem> {
  const res = await fetch(`${API_BASE_URL}/api/wanted-listings/${wantedListingId}/respond/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ message }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || "Failed to respond to wanted listing");
  return json;
}

export interface AgentPublicProfile {
  full_name: string;
  is_kyc_verified: boolean;
  average_rating: number | null;
  rating_count: number;
  active_listing_count: number;
  agency_name: string | null;
}

export async function getAgentPublicProfile(userId: string): Promise<AgentPublicProfile> {
  const res = await fetch(`${API_BASE_URL}/api/agents/${userId}/profile/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Agent profile fetch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Public User Role Index / Portfolio Hub
// ---------------------------------------------------------------------------
export interface UserRoleIndexHotel {
  id: string;
  quarter_name: string;
  star_rating: number | null;
  total_rooms: number;
  verified: boolean;
  latitude?: number | null;
  longitude?: number | null;
  cheapest_rate_xaf: number | null;
  photo_url: string | null;
  room_categories: string[];
}

export interface UserRoleIndexHostel {
  id: string;
  quarter_name: string;
  property_type: string;
  total_units: number;
  latitude?: number | null;
  longitude?: number | null;
  photo_url: string | null;
  unit_types: string[];
}

export interface UserRoleIndexGuestHouse {
  id: string;
  quarter_name: string;
  is_coastal_leisure: boolean;
  finish_level: string;
  latitude?: number | null;
  longitude?: number | null;
  photo_url: string | null;
}

export interface UserRoleIndexVenue {
  id: string;
  quarter_name: string;
  verified: boolean;
  total_spaces: number;
  latitude?: number | null;
  longitude?: number | null;
  photo_url: string | null;
}

export interface UserRoleIndexListing {
  id: string;
  title: string;
  property_type: string;
  house_style: string;
  listing_type: string;
  price_xaf: number;
  quarter_name: string;
  latitude?: number | null;
  longitude?: number | null;
  photo_url: string | null;
  published_at: string | null;
}

export interface UserRoleIndexStats {
  hotels_count: number;
  hostels_count: number;
  guest_houses_count: number;
  venues_count: number;
  listings_count: number;
  apartments_count: number;
  houses_count: number;
  lands_count: number;
}

export interface UserRoleIndexTechnician {
  specialties: string[];
  coverage_quarter_name: string | null;
  is_verified: boolean;
  completed_jobs: number;
}

export interface UserRoleIndexDriver {
  license_number: string;
  is_verified: boolean;
  completed_rides: number;
  vehicles: {
    id: string;
    make: string;
    model: string;
    plate_number: string;
    vehicle_category: string;
  }[];
}

export interface UserRoleIndexStudent {
  institution_name: string;
  programme_year: number | null;
  is_international_student: boolean;
}

export interface UserRoleIndexProfile {
  user_id: string;
  username: string;
  full_name: string;
  profile_image_url?: string;
  phone: string;
  roles: string[];
  is_kyc_verified: boolean;
  average_rating: number | null;
  rating_count: number;
  agency_name: string | null;
  technician?: UserRoleIndexTechnician | null;
  driver?: UserRoleIndexDriver | null;
  student?: UserRoleIndexStudent | null;
  stats: UserRoleIndexStats;
  hotels: UserRoleIndexHotel[];
  hostels: UserRoleIndexHostel[];
  guest_houses: UserRoleIndexGuestHouse[];
  venues: UserRoleIndexVenue[];
  listings: UserRoleIndexListing[];
}

export async function getUserPublicIndex(userId: string): Promise<UserRoleIndexProfile> {
  const res = await fetch(`${API_BASE_URL}/api/users/${userId}/index/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`User index fetch failed: ${res.status}`);
  return res.json();
}


// ---------------------------------------------------------------------------
// Real ratings and reporting a person directly — closing the gap
// between the aggregated rating a profile already shows and any real
// way for a visitor to actually contribute one.
// ---------------------------------------------------------------------------
export async function rateUser(subjectUserId: string, score: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/ratings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ subject_user: subjectUserId, score }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not submit rating");
  return data;
}

export interface RatingItem {
  id: number;
  author: string;
  author_name: string;
  subject_user: string | null;
  subject_property_id: string | null;
  score: string;
  created_at: string;
}

export interface MyRatingsResult {
  average_rating: number | null;
  rating_count: number;
  ratings_received: RatingItem[];
  ratings_given: RatingItem[];
}

export async function getMyRatings(accessToken: string): Promise<MyRatingsResult> {
  const res = await fetch(`${API_BASE_URL}/api/my-ratings/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not fetch ratings");
  return res.json();
}

// ---------------------------------------------------------------------------
// Follow / Unfollow — one-tap, real UC13 (docs/01 use-case diagram).
// ---------------------------------------------------------------------------
export interface FollowStatus {
  is_following: boolean;
  is_mutual: boolean;
  follower_count: number;
  following_count: number;
}

export async function getFollowStatus(userId: string, accessToken: string): Promise<FollowStatus> {
  const res = await fetch(`${API_BASE_URL}/api/users/${userId}/follow/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch follow status");
  return res.json();
}

export async function toggleFollow(userId: string, accessToken: string): Promise<FollowStatus> {
  const res = await fetch(`${API_BASE_URL}/api/users/${userId}/follow/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not update follow status");
  return data;
}

// ---------------------------------------------------------------------------
// Platform-wide listing waitlist (Prompt 15 "NEW — Waitlist").
// ---------------------------------------------------------------------------
export async function joinListingWaitlist(listingId: string, accessToken: string): Promise<{ already_joined: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/listings/${listingId}/join-waitlist/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not join the waitlist");
  return data;
}

// ---------------------------------------------------------------------------
// Hostel waitlist (Prompt 11).
// ---------------------------------------------------------------------------
export async function joinHostelWaitlist(
  payload: { hostel: string; desired_unit_type: string; semester: number },
  accessToken: string,
) {
  const res = await fetch(`${API_BASE_URL}/api/my-hostel-waitlist/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not join the hostel waitlist");
  return data;
}

export interface HostelSemesterItem {
  id: number;
  institution: number;
  institution_name: string;
  name: string;
  start_date: string;
  end_date: string;
  billing_due_date: string;
}

export async function listHostelSemesters(hostelId: string): Promise<HostelSemesterItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/student-hostels/${hostelId}/semesters/`);
  if (!res.ok) throw new Error("Could not fetch this hostel's semesters");
  return res.json();
}

// ---------------------------------------------------------------------------
// Gamified badges (Prompt 15 "NEW — GamifiedBadge").
// ---------------------------------------------------------------------------
export interface MyBadgeItem {
  badge_code: string;
  label: string;
  awarded_at: string;
}

export async function getMyBadges(accessToken: string): Promise<{ count: number; results: MyBadgeItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-badges/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch badges");
  return res.json();
}

// ---------------------------------------------------------------------------
// Agency roster management (RBAC: "Manage agent roster").
// ---------------------------------------------------------------------------
export async function addAgentToRoster(agentUserId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-agency-dashboard/add-agent/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ agent_user_id: agentUserId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not add this agent to the roster");
  return data;
}

export async function removeAgentFromRoster(agentUserId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-agency-dashboard/remove-agent/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ agent_user_id: agentUserId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not remove this agent from the roster");
  return data;
}

export async function fileReportAgainstUser(targetUserId: string, reason: string, notes: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/content-reports/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ target_user: targetUserId, reason, notes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not submit report");
  return data;
}

export async function fileReportAgainstListing(listingId: string, reason: string, notes: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/content-reports/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ target_listing_id: listingId, reason, notes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not submit report");
  return data;
}

export async function setupMfa(mfaType: "SMS_OTP" | "EMAIL_OTP", destination: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/auth/mfa/setup/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ mfa_type: mfaType, destination }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "MFA setup failed");
  return res.json();
}

export async function verifyMfa(challengeId: string, code: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/auth/mfa/verify/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Incorrect or expired code");
  return res.json();
}

export async function getMfaStatus(accessToken: string): Promise<{ mfa_enabled: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/mfa/status/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not check MFA status");
  return res.json();
}

export interface ServiceOffering {
  id: string;
  name: string;
  category_name: string;
  description: string;
  sourced_via: string;
  price_hint_xaf: string | null;
}

export interface ServiceCategory {
  id: string;
  name: string;
  offerings: ServiceOffering[];
}

export async function listServiceCategories(): Promise<PaginatedResponse<ServiceCategory>> {
  const res = await fetch(`${API_BASE_URL}/api/service-categories/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Service catalogue fetch failed: ${res.status}`);
  return res.json();
}

export interface PartnerServiceRequestItem {
  id: string;
  offering: number;
  offering_name: string;
  notes: string;
  status: "REQUESTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  requested_at: string;
  completed_at: string | null;
}

export async function requestPartnerService(offeringId: number, notes: string, accessToken: string): Promise<PartnerServiceRequestItem> {
  const res = await fetch(`${API_BASE_URL}/api/partner-services/request/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ offering: offeringId, notes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not request this service");
  return data;
}

export async function getMyPartnerServiceRequests(accessToken: string): Promise<{ count: number; results: PartnerServiceRequestItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-partner-service-requests/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch your service requests");
  return res.json();
}

export interface AgentDirectoryEntry {
  user_id: string;
  full_name: string;
  is_kyc_verified: boolean;
  average_rating: number | null;
  rating_count: number;
  active_listing_count: number;
  agency_name: string | null;
}

export async function listAgents(): Promise<{ count: number; results: AgentDirectoryEntry[] }> {
  const res = await fetch(`${API_BASE_URL}/api/agents/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Agent directory fetch failed: ${res.status}`);
  return res.json();
}

export interface AgencyDirectoryEntry {
  agency_id: string;
  agency_name: string;
  registration_number: string;
  agent_count: number;
  average_rating: number | null;
  rating_count: number;
  active_listing_count: number;
}

export async function listAgencies(): Promise<{ count: number; results: AgencyDirectoryEntry[] }> {
  const res = await fetch(`${API_BASE_URL}/api/agencies/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Agency directory fetch failed: ${res.status}`);
  return res.json();
}

export async function getAgencyPublicProfile(agencyId: string): Promise<AgencyDirectoryEntry> {
  const res = await fetch(`${API_BASE_URL}/api/agencies/${agencyId}/profile/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Agency profile fetch failed: ${res.status}`);
  return res.json();
}

export interface PopularQuarter {
  id: string;
  name: string;
  area: string;
  listing_count: number;
  min_rent_xaf: string | null;
  max_rent_xaf: string | null;
}

export interface HomeStats {
  published_listings: number;
  rent_listings: number;
  sale_listings: number;
  new_listings_24h: number;
  hotels: number;
  venues: number;
  guest_houses: number;
  student_hostels: number;
  drivers: number;
  popular_quarters: PopularQuarter[];
}

export async function getHomeStats(): Promise<HomeStats> {
  const res = await fetch(`${API_BASE_URL}/api/home-stats/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Home stats failed: ${res.status}`);
  return res.json();
}

export interface Testimonial {
  author_name: string;
  score: number;
  text: string;
  created_at: string;
}

export async function listTestimonials(): Promise<{ count: number; results: Testimonial[] }> {
  const res = await fetch(`${API_BASE_URL}/api/testimonials/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Testimonials fetch failed: ${res.status}`);
  return res.json();
}

export async function submitContactMessage(payload: { name: string; email: string; message: string }) {
  const res = await fetch(`${API_BASE_URL}/api/contact/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Contact submission failed");
  return res.json();
}

export interface Faq {
  id: number;
  question: string;
  answer: string;
}

/** Published FAQs in the given language (`homepageOnly` keeps the ones flagged for the homepage). */
export async function listPublicFaqs(locale: string, homepageOnly = false): Promise<Faq[]> {
  const query = new URLSearchParams({ lang: locale });
  if (homepageOnly) query.set("homepage", "1");
  const res = await fetch(`${API_BASE_URL}/api/faqs/?${query.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`FAQ fetch failed: ${res.status}`);
  return res.json();
}

export interface AdminFaq {
  id: number;
  question_en: string;
  answer_en: string;
  question_fr: string;
  answer_fr: string;
  display_order: number;
  is_published: boolean;
  show_on_homepage: boolean;
}

export type AdminFaqInput = Partial<Omit<AdminFaq, "id" | "display_order">>;

async function adminFaqRequest<T>(path: string, init: RequestInit, accessToken: string): Promise<T> {
  const res = await fetchWithAutoRefresh(
    `${API_BASE_URL}/api/admin/faqs/${path}`,
    { ...init, headers: { "Content-Type": "application/json", ...init.headers } },
    accessToken
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || Object.values(data).flat().join(" ") || "FAQ request failed");
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const listAdminFaqs = (token: string) => adminFaqRequest<AdminFaq[]>("", {}, token);
export const createAdminFaq = (payload: AdminFaqInput, token: string) =>
  adminFaqRequest<AdminFaq>("", { method: "POST", body: JSON.stringify(payload) }, token);
export const updateAdminFaq = (id: number, payload: AdminFaqInput, token: string) =>
  adminFaqRequest<AdminFaq>(`${id}/`, { method: "PATCH", body: JSON.stringify(payload) }, token);
export const deleteAdminFaq = (id: number, token: string) => adminFaqRequest<void>(`${id}/`, { method: "DELETE" }, token);
export const reorderAdminFaqs = (ids: number[], token: string) =>
  adminFaqRequest<AdminFaq[]>("reorder/", { method: "POST", body: JSON.stringify({ ids }) }, token);

export interface TrainingProgram {
  id: string;
  title: string;
  description: string;
  category: string;
  provider_name: string;
  price_xaf: string | null;
  issues_certification: boolean;
}

export async function listTrainings(): Promise<{ count: number; results: TrainingProgram[] }> {
  const res = await fetch(`${API_BASE_URL}/api/trainings/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Training fetch failed: ${res.status}`);
  return res.json();
}

export async function enrollInTraining(programId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/trainings/${programId}/enroll/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res;
}

export interface TrainingEnrollmentItem {
  id: string;
  program: string;
  status: "ENROLLED" | "IN_PROGRESS" | "COMPLETED" | "DROPPED";
  enrolled_at: string;
  completed_at: string | null;
  certificate_issued_at: string | null;
}

export async function getMyEnrollments(accessToken: string): Promise<{ count: number; results: TrainingEnrollmentItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-enrollments/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not fetch enrollments");
  return res.json();
}

export async function startTraining(enrollmentId: string, accessToken: string): Promise<TrainingEnrollmentItem> {
  const res = await fetch(`${API_BASE_URL}/api/my-enrollments/${enrollmentId}/start/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not start this training");
  return res.json();
}

export async function dropTraining(enrollmentId: string, accessToken: string): Promise<TrainingEnrollmentItem> {
  const res = await fetch(`${API_BASE_URL}/api/my-enrollments/${enrollmentId}/drop/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not drop this training");
  return res.json();
}

export async function completeTraining(enrollmentId: string, accessToken: string): Promise<TrainingEnrollmentItem> {
  const res = await fetch(`${API_BASE_URL}/api/my-enrollments/${enrollmentId}/complete/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not mark this training as completed");
  return res.json();
}

// ---------------------------------------------------------------------------
// Job posting management (poster side) & WhatsApp share.
// ---------------------------------------------------------------------------
export interface JobApplicationItem {
  id: string;
  job_posting: string;
  applicant: string;
  applicant_name: string;
  cover_message: string;
  status: string;
  applied_at: string;
}

export async function listJobApplications(jobId: string, accessToken: string): Promise<JobApplicationItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/applications/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch applications");
  return res.json();
}

export async function updateJobApplicationStatus(jobId: string, applicationId: string, newStatus: string, accessToken: string): Promise<JobApplicationItem> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/update-application/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ application_id: applicationId, new_status: newStatus }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not update application status");
  return data;
}

export async function shareJobPostingViaWhatsApp(jobId: string, recipientPhone: string, accessToken: string): Promise<{ deep_link: string; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/share/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ recipient_phone: recipientPhone }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not build a share link");
  return data;
}

export async function getMyReferralCode(accessToken: string): Promise<{ referral_code: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/my-referral-code/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not fetch referral code");
  return res.json();
}

export interface AgentPerformanceScore {
  avg_response_time_minutes: number | null;
  percent_listings_verified: number | null;
  completed_deals_count: number;
}

export interface AgentDashboard {
  performance_score: AgentPerformanceScore;
  open_enquiries: number;
  commission_trend_xaf: { current_period_value: string; previous_period_value: string; percent_change: number | null };
  is_agency_owner: boolean;
  agency_roster?: { user__username: string }[];
  agency_aggregated_commission_xaf?: string;
}

export async function getMyAgentDashboard(accessToken: string): Promise<AgentDashboard> {
  const res = await fetch(`${API_BASE_URL}/api/my-agent-dashboard/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Dashboard fetch failed: ${res.status}`);
  return res.json();
}

export interface AgencyDashboard {
  agency_profile: {
    agency_name: string;
    registration_number: string;
    agent_count: number;
    average_rating: number | null;
    rating_count: number;
    active_listing_count: number;
  };
  team: { user_id: string; full_name: string; active_listing_count: number; open_enquiries: number }[];
  team_size: number;
  active_team_listings: number;
  open_team_leads: number;
  agency_aggregated_commission_xaf: string;
  commission_trend_xaf: { current_period_value: string; previous_period_value: string; percent_change: number | null };
}

export async function getMyAgencyDashboard(accessToken: string): Promise<AgencyDashboard> {
  const res = await fetch(`${API_BASE_URL}/api/my-agency-dashboard/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Agency dashboard fetch failed: ${res.status}`);
  return res.json();
}

export interface PeriodTrend {
  current_period_value: number;
  previous_period_value: number;
  percent_change: number | null;
}

export interface LandlordPortfolio {
  total_properties: number;
  total_listings: number;
  published_listings: number;
  completed_bookings: number;
  total_commission_paid_xaf: string;
  bookings_trend: PeriodTrend;
}

export async function getMyLandlordPortfolio(accessToken: string): Promise<LandlordPortfolio> {
  const res = await fetch(`${API_BASE_URL}/api/my-landlord-portfolio/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Landlord portfolio fetch failed: ${res.status}`);
  return res.json();
}

export interface TickStatus {
  delivered: boolean;
  seen: boolean;
}

export interface ConversationMessage {
  id: string;
  conversation: string;
  sender: string;
  sender_name: string;
  text: string;
  folder: string;
  sent_at: string | null;
  created_at: string;
  tick_status: TickStatus;
}

export interface ConversationSummary {
  id: string;
  participant_usernames: string[];
  participants_details?: { id: string; username: string; full_name: string; profile_image_url: string | null; is_online: boolean; last_seen_at: string | null; is_blocked: boolean }[];
  last_message: ConversationMessage | null;
  unread_count: number;
  created_at: string;
}

export async function listConversations(accessToken: string): Promise<{ results: ConversationSummary[] }> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not fetch conversations");
  return res.json();
}

export async function getConversationMessages(conversationId: string, accessToken: string): Promise<ConversationMessage[]> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/messages/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not fetch messages");
  return res.json();
}

export async function sendConversationMessage(conversationId: string, text: string, accessToken: string): Promise<ConversationMessage> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/send/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text, client_message_id: `web-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
  });
  if (!res.ok) throw new Error("Could not send message");
  return res.json();
}

export async function markConversationSeen(conversationId: string, accessToken: string) {
  await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/mark_seen/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function sendTypingHeartbeat(conversationId: string, accessToken: string) {
  await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/typing/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function getTypingStatus(conversationId: string, accessToken: string): Promise<{ typing_usernames: string[] }> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/typing-status/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { typing_usernames: [] };
  return res.json();
}

export interface BlockedUser {
  id: string;
  username: string;
  full_name: string;
  profile_image_url: string | null;
  blocked_at: string;
}

export async function setUserBlocked(userId: string, blocked: boolean, accessToken: string): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/api/users/${userId}/block/`, {
    method: blocked ? "POST" : "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(blocked ? "Could not block this user" : "Could not unblock this user");
  return (await res.json()).is_blocked;
}

export async function listBlockedUsers(accessToken: string): Promise<{ results: BlockedUser[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-blocked-users/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not fetch blocked users");
  return res.json();
}

export async function sendPresenceHeartbeat(accessToken: string, options: { offline?: boolean } = {}): Promise<void> {
  await fetch(`${API_BASE_URL}/api/presence/${options.offline ? "offline" : "heartbeat"}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    keepalive: options.offline === true,
  });
}

export interface PresenceSettings {
  show_online_status: boolean;
  show_typing_indicator: boolean;
}

export async function getMyPresenceSettings(accessToken: string): Promise<PresenceSettings> {
  const res = await fetch(`${API_BASE_URL}/api/my-presence-settings/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not fetch presence settings");
  return res.json();
}

export async function updateMyPresenceSettings(settings: Partial<PresenceSettings>, accessToken: string): Promise<PresenceSettings> {
  const res = await fetch(`${API_BASE_URL}/api/my-presence-settings/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error("Could not update presence settings");
  return res.json();
}

export interface AdminPlatformAnalytics {
  total_users: number;
  total_agents: number;
  total_landlords: number;
  total_technicians: number;
  total_drivers: number;
  active_listings_count: number;
  total_hotels_count: number;
  total_venues_count: number;
  total_hostels_count: number;
  total_bookings_count: number;
  escrow_volume_xaf: string;
  escrow_held_xaf: string;
  escrow_released_xaf: string;
  platform_revenue_xaf: string;
  total_disputed_amount_xaf: string;
}

export interface AdminConsoleSummary {
  pending_verification_requests: number;
  open_content_reports: number;
  open_dispute_cases: number;
  pending_property_listings?: number;
  pending_hotels?: number;
  pending_venues?: number;
  pending_drivers?: number;
  open_welfare_alerts?: number;
  flagged_users_count?: number;
  reports_trend: { current_period_value: number; previous_period_value: number; percent_change: number | null };
  platform_analytics?: AdminPlatformAnalytics;
}

export interface AdminVerificationRequest {
  id: string;
  requester: string;
  requester_name: string;
  request_type: string;
  subject_content_type: string;
  subject_id: string;
  status: string;
  supporting_document_url: string;
  submitted_at: string;
}

export interface AdminKycReviewItem {
  id: number;
  username: string;
  full_name: string;
  legal_full_name: string;
  date_of_birth: string;
  national_id_number: string;
  id_document_front_image_url: string;
  id_document_back_image_url: string;
  selfie_image_url: string;
  residential_address: string;
  kyc_status: string;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface AdminContentReport {
  id: string;
  reported_by: string;
  reported_by_name: string;
  reason: string;
  status: string;
  target_post: string | null;
  target_listing_id: string | null;
  target_comment: string | null;
  notes: string;
  created_at: string;
}

export interface AdminDisputeCase {
  id: string;
  escrow: string;
  raised_by: string;
  raised_by_name: string;
  status: string;
  reason: string;
  created_at: string;
  response_due_at: string;
  resolution_due_at: string;
}

function adminHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function getAdminConsoleSummary(accessToken: string): Promise<AdminConsoleSummary> {
  const res = await fetch(`${API_BASE_URL}/api/admin/console-summary/`, { headers: adminHeaders(accessToken) });
  if (!res.ok) throw new Error(`Admin summary fetch failed: ${res.status}`);
  return res.json();
}

export async function listAdminVerificationRequests(accessToken: string): Promise<{ count: number; results: AdminVerificationRequest[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/verification-requests/`, { headers: adminHeaders(accessToken) });
  if (!res.ok) throw new Error(`Verification requests fetch failed: ${res.status}`);
  return res.json();
}

export async function approveVerificationRequest(id: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/verification-requests/${id}/approve/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export async function rejectVerificationRequest(id: string, reason: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/verification-requests/${id}/reject/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ reason }),
  });
}

export async function listAdminKycReviews(accessToken: string): Promise<{ count: number; results: AdminKycReviewItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/kyc-reviews/`, { headers: adminHeaders(accessToken) });
  if (!res.ok) throw new Error(`KYC reviews fetch failed: ${res.status}`);
  return res.json();
}

export async function approveKyc(id: number, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/kyc-reviews/${id}/approve/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export async function rejectKyc(id: number, reason: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/kyc-reviews/${id}/reject/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ reason }),
  });
}

export async function listAdminContentReports(accessToken: string): Promise<{ count: number; results: AdminContentReport[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/content-reports/`, { headers: adminHeaders(accessToken) });
  if (!res.ok) throw new Error(`Content reports fetch failed: ${res.status}`);
  return res.json();
}

export async function resolveContentReport(id: string, actionTaken: string, issueStrike: boolean, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/content-reports/${id}/resolve/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ action_taken: actionTaken, issue_strike: issueStrike }),
  });
}

export async function listAdminDisputeCases(accessToken: string): Promise<{ count: number; results: AdminDisputeCase[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/dispute-cases/`, { headers: adminHeaders(accessToken) });
  if (!res.ok) throw new Error(`Dispute cases fetch failed: ${res.status}`);
  return res.json();
}

export async function respondToDispute(id: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/dispute-cases/${id}/respond/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export async function resolveDispute(id: string, outcome: "RELEASE" | "REFUND", notes: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/dispute-cases/${id}/resolve/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ outcome, notes }),
  });
}

export interface AdminWelfareAlert {
  id: string;
  student: string;
  student_name: string;
  student_username: string;
  student_phone: string;
  reason: string;
  details: string;
  raised_by: string | null;
  raised_by_name: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface AdminUser {
  id: string;
  username: string;
  phone: string;
  email: string | null;
  full_name: string;
  verification_status: string;
  account_status: "ACTIVE" | "SUSPENDED" | "BANNED";
  suspended_until: string | null;
  strikes_count: number;
  date_joined: string;
  is_admin: boolean;
  is_agent: boolean;
  is_landlord: boolean;
  is_agency: boolean;
  is_student: boolean;
  is_technician: boolean;
  is_driver: boolean;
  kyc_status: string | null;
}

export async function listAdminPendingPropertyListings(accessToken: string): Promise<{ count: number; results: Listing[] }> {
  const res = await fetch(`${API_BASE_URL}/api/listings/pending/`, { headers: adminHeaders(accessToken) });
  if (!res.ok) throw new Error(`Pending listings fetch failed: ${res.status}`);
  return res.json();
}

export async function approvePropertyListing(listingId: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/listings/${listingId}/approve/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export async function rejectPropertyListing(listingId: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/listings/${listingId}/reject/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export async function listAdminWelfareAlerts(accessToken: string): Promise<{ count: number; results: AdminWelfareAlert[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/welfare-alerts/`, { headers: adminHeaders(accessToken) });
  if (!res.ok) throw new Error(`Welfare alerts fetch failed: ${res.status}`);
  return res.json();
}

export async function resolveAdminWelfareAlert(alertId: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/welfare-alerts/${alertId}/resolve/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export interface AdminSosPerson {
  id: string;
  name: string;
  phone: string;
}

export interface AdminSosRide {
  id: string;
  status: string;
  pickup_description: string;
  dropoff_description: string;
  vehicle_details: { vehicle_category: string; make: string; model: string; plate_number: string } | null;
  rider: AdminSosPerson | null;
  driver: AdminSosPerson | null;
  raised_by: AdminSosPerson | null;
  raised_by_contact: { name: string; phone: string } | null;
  sos_raised_at: string;
  sos_latitude: string | null;
  sos_longitude: string | null;
  sos_note: string;
  sos_resolved_at: string | null;
}

export async function listAdminSosRides(accessToken: string, status: "open" | "resolved" | "all" = "open"): Promise<{ count: number; results: AdminSosRide[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/sos-rides/?status=${status}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`SOS rides fetch failed: ${res.status}`);
  return res.json();
}

export async function resolveAdminSosRide(rideId: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/sos-rides/${rideId}/resolve/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export async function listAdminUsers(
  accessToken: string,
  accountStatus?: string,
  role?: string,
  page?: number
): Promise<{ count: number; next: string | null; previous: string | null; results: AdminUser[] }> {
  const params = new URLSearchParams();
  if (accountStatus) params.set("account_status", accountStatus);
  if (role) params.set("role", role);
  if (page) params.set("page", String(page));
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/admin/users/${query}`, { headers: adminHeaders(accessToken) });
  if (!res.ok) throw new Error(`Admin users fetch failed: ${res.status}`);
  return res.json();
}

export async function toggleAdminUserSuspend(userId: string, suspend: boolean, days: number = 30, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/users/${userId}/toggle-suspend/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ suspend, days }),
  });
}

export async function issueAdminUserStrike(userId: string, reason: string = "ADMIN_REVIEWED_REPORT", accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/users/${userId}/issue-strike/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ reason }),
  });
}

export type AssignableRole = "landlord" | "agent" | "agency" | "student" | "technician" | "driver" | "admin";

export async function assignAdminUserRole(
  userId: string,
  role: AssignableRole,
  extra: Record<string, string> = {},
  accessToken: string = ""
): Promise<AdminUser> {
  const res = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/assign-role/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ role, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not assign role");
  return data;
}

export async function removeAdminUserRole(userId: string, role: AssignableRole, accessToken: string): Promise<AdminUser> {
  const res = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/remove-role/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ role }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not remove role");
  return data;
}

export interface SavedMarketplaceListing {
  id: string;
  category: MarketplaceCategory;
  title: string;
  price_xaf: string;
  price_basis: string;
  availability_status: string;
  quarter_name: string | null;
  photo_url: string | null;
}

export async function getMyFavorites(accessToken: string): Promise<{ listing_ids: string[]; marketplace_listings: SavedMarketplaceListing[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-favorites/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch favorites");
  return res.json();
}

export async function toggleFavoriteListing(listingId: string, accessToken: string): Promise<{ is_favorited: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/listings/${listingId}/toggle-favorite/`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not update favorite");
  return res.json();
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, string>;
  last_notified_at: string | null;
}

export async function listSavedSearches(accessToken: string): Promise<{ count: number; results: SavedSearch[] }> {
  const res = await fetch(`${API_BASE_URL}/api/saved-searches/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch saved searches");
  return res.json();
}

export async function createSavedSearch(name: string, filters: Record<string, string>, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/saved-searches/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name, filters }),
  });
  if (!res.ok) throw new Error("Could not create saved search");
  return res.json();
}

export async function deleteSavedSearch(id: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/saved-searches/${id}/`, {
    method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export interface PropertyComparisonData {
  id: string;
  listing_ids: string[];
  created_at: string;
}

export async function getMyComparison(accessToken: string): Promise<PropertyComparisonData | null> {
  const res = await fetch(`${API_BASE_URL}/api/my-comparison/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not fetch comparison");
  return res.json();
}

export async function setMyComparison(listingIds: string[], accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-comparison/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ listing_ids: listingIds }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not update comparison");
  return res.json();
}

export interface AppNotification {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  channel: string;
  delivered: boolean;
  read_at: string | null;
  created_at: string;
}

export async function listMyNotifications(accessToken: string): Promise<{ count: number; results: AppNotification[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-notifications/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch notifications");
  return res.json();
}

export async function getUnreadNotificationCount(accessToken: string): Promise<{ unread_count: number }> {
  const res = await fetch(`${API_BASE_URL}/api/my-notifications/unread-count/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return { unread_count: 0 };
  return res.json();
}

export async function markNotificationRead(id: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/my-notifications/${id}/mark_read/`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function markAllNotificationsRead(accessToken: string) {
  return fetch(`${API_BASE_URL}/api/my-notifications/mark-all-read/`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export interface SocialPost {
  id: string;
  author: string;
  author_name: string;
  is_verified_creator: boolean;
  poster_role: string;
  post_type: string;
  caption: string;
  tag_names: string[];
  media: { id: string; media_type: string; file_url: string }[];
  linked_listing_id: string | null;
  status: string;
  published_at: string | null;
  created_at: string;
  reaction_counts: Record<string, number>;
  comment_count: number;
  is_sponsored: boolean;
}

export async function listFeedPosts(accessToken?: string): Promise<{ count: number; results: SocialPost[] }> {
  const res = await fetch(`${API_BASE_URL}/api/posts/`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not fetch feed");
  return res.json();
}

export async function listFollowingFeed(accessToken: string): Promise<{ count: number; results: SocialPost[] }> {
  const res = await fetch(`${API_BASE_URL}/api/posts/following/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch following feed");
  return res.json();
}

export async function searchPosts(query: string): Promise<{ count: number; results: SocialPost[] }> {
  const res = await fetch(`${API_BASE_URL}/api/posts/search/?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Could not search posts");
  return res.json();
}

export async function createPost(
  payload: { caption: string; tags?: string[]; linked_listing_id?: string; media_urls?: string[] },
  accessToken: string
): Promise<{ id: string } & Record<string, unknown>> {
  const res = await fetch(`${API_BASE_URL}/api/posts/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not create post");
  return data;
}

export async function reactToPost(postId: string, emoji: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/react/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw new Error("Could not react to post");
  return res.json();
}

export interface PostComment {
  id: string;
  post: string;
  author: string;
  author_name: string;
  text: string;
  created_at: string;
}

export async function getPostComments(postId: string): Promise<PostComment[]> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/comments/`);
  if (!res.ok) throw new Error("Could not fetch comments");
  return res.json();
}

export async function addPostComment(postId: string, text: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/comments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ post: postId, text }),
  });
  if (!res.ok) throw new Error("Could not add comment");
  return res.json();
}

export async function getMyCreatorPremiumStatus(accessToken: string): Promise<{ is_premium: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/my-creator-premium/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch premium status");
  return res.json();
}

export async function subscribeCreatorPremium(phoneNumber: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-creator-premium/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Subscription failed");
  return data;
}

export async function cancelCreatorPremium(accessToken: string) {
  return fetch(`${API_BASE_URL}/api/my-creator-premium/`, {
    method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// What a person can choose to do at signup; "renter" is the normal-user default.
export const SIGNUP_ROLES = ["renter", "landlord", "agent", "student", "technician", "driver"] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

export async function registerUser(payload: {
  username: string;
  phone: string;
  password: string;
  referral_code?: string;
  role?: SignupRole;
}): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json();
    // plain CreateAPIView validation errors are field-keyed arrays, not {detail}
    const firstFieldError = Object.values(data).flat().find((v) => typeof v === "string");
    throw new Error(data.detail || firstFieldError || "Registration failed");
  }
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

// ---------------------------------------------------------------------------
// Job postings — mirrors the real backend API exactly.
// ---------------------------------------------------------------------------
export interface JobPosting {
  id: string;
  posted_by: string;
  posted_by_name: string;
  title: string;
  role_category: string;
  description: string;
  quarter: string | null;
  quarter_name: string | null;
  salary_min_xaf: string | null;
  salary_max_xaf: string | null;
  status: string;
  posted_at: string;
  closes_at: string | null;
  application_count: number;
}

export async function listJobPostings(): Promise<{ count: number; results: JobPosting[] }> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/`);
  if (!res.ok) throw new Error(`Job postings fetch failed: ${res.status}`);
  return res.json();
}

export async function applyToJob(jobId: string, coverMessage: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/apply/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ cover_message: coverMessage }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not submit application");
  return data;
}

// ---------------------------------------------------------------------------
// Property Management — real maintenance, tenant screening, agent
// safety check-ins, leases, and dispute-opening.
// ---------------------------------------------------------------------------
export interface MaintenanceCostEntry {
  id: number;
  amount_xaf: string;
  note: string;
  recorded_at: string;
}

export interface MaintenanceRequestItem {
  id: string;
  property_asset: string;
  reported_by: string;
  reported_by_name: string;
  category: string;
  description: string;
  cost_estimate_xaf: string | null;
  status: string;
  reported_at: string;
  resolved_at: string | null;
  cost_entries: MaintenanceCostEntry[];
}

export async function listMaintenanceRequests(accessToken: string): Promise<{ count: number; results: MaintenanceRequestItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/maintenance-requests/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch maintenance requests");
  return res.json();
}

export async function createMaintenanceRequest(
  payload: { property_asset: string; category: string; description: string },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/maintenance-requests/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not create maintenance request");
  return data;
}

export async function addMaintenanceCost(requestId: string, amountXaf: string, note: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/maintenance-requests/${requestId}/add-cost/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ amount_xaf: amountXaf, note }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not add cost");
  return res.json();
}

export async function closeMaintenanceRequest(requestId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/maintenance-requests/${requestId}/close/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not close maintenance request");
  return res.json();
}

export interface TenantScreeningItem {
  id: string;
  landlord: string;
  landlord_name: string;
  prospective_tenant: string;
  prospective_tenant_name: string;
  status: string;
  report_summary: { completed_bookings: number; average_review_score: number | null; warning_count: number } | null;
  requested_at: string;
  consented_at: string | null;
}

export async function listTenantScreenings(accessToken: string): Promise<{ count: number; results: TenantScreeningItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/tenant-screenings/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch tenant screenings");
  return res.json();
}

export async function requestTenantScreening(prospectiveTenantId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/tenant-screenings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ prospective_tenant: prospectiveTenantId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not request screening");
  return data;
}

export async function consentToScreening(screeningId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/tenant-screenings/${screeningId}/consent/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not grant consent");
  return res.json();
}

export async function generateScreeningReport(screeningId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/tenant-screenings/${screeningId}/generate-report/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not generate report");
  return res.json();
}

export interface SafetyCheckInItem {
  id: string;
  agent: string;
  agent_name: string;
  property_asset: string | null;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  started_at: string;
  expected_checkout_at: string;
  checked_out_at: string | null;
  status: string;
}

export async function listSafetyCheckIns(accessToken: string): Promise<{ count: number; results: SafetyCheckInItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/safety-check-ins/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch safety check-ins");
  return res.json();
}

export async function startSafetyCheckIn(
  payload: { property_asset?: string; emergency_contact_name: string; emergency_contact_phone: string; expected_duration_minutes: number },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/safety-check-ins/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not start check-in");
  return data;
}

export async function checkOutSafely(checkInId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/safety-check-ins/${checkInId}/check-out/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not check out");
  return res.json();
}

export interface LeaseItem {
  id: string;
  booking: string;
  start_date: string;
  end_date: string;
}

export async function listLeases(accessToken: string): Promise<{ count: number; results: LeaseItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/leases/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch leases");
  return res.json();
}

export async function createLease(
  payload: { booking: string; start_date: string; end_date: string },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/leases/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.booking?.[0] || "Could not create lease");
  return data;
}


// ---------------------------------------------------------------------------
// Marketplace — warehouses, stores, businesses, cars, and real
// ride-hailing. Mirrors the real backend API exactly.
// ---------------------------------------------------------------------------
export interface MarketplaceMediaItem {
  id: number;
  media_type: "PHOTO" | "VIDEO";
  file_url: string;
  order: number;
}

interface BaseMarketplaceListing {
  id: string;
  lister_user: string;
  lister_name: string;
  lister_role: string;
  title: string;
  description: string;
  price_basis: string;
  price_xaf: string;
  quarter: string | null;
  quarter_name: string | null;
  latitude: string | null;
  longitude: string | null;
  availability_status: string;
  created_at: string;
  media: MarketplaceMediaItem[];
}

export interface WarehouseListing extends BaseMarketplaceListing {
  size_sqm: string;
}
export interface StoreListing extends BaseMarketplaceListing {
  size_sqm: string;
  frontage_meters: string | null;
}
export interface BusinessListing extends BaseMarketplaceListing {
  size_sqm: string | null;
  seating_capacity: number | null;
  includes_goodwill: boolean;
  includes_inventory: boolean;
  annual_revenue_xaf: string | null;
}
export interface VehicleSpec {
  make: string;
  model: string;
  year: number;
  mileage_km: number | null;
  engine_size_cc: number | null;
}
export interface CarListing extends BaseMarketplaceListing {
  vehicle_spec: VehicleSpec;
}

const MARKETPLACE_ENDPOINTS = { warehouses: "warehouses", stores: "stores", businesses: "businesses", cars: "cars" } as const;
export type MarketplaceCategory = keyof typeof MARKETPLACE_ENDPOINTS;

export async function listMarketplaceListings<T>(category: MarketplaceCategory, filters?: Record<string, string>): Promise<{ count: number; results: T[] }> {
  const query = filters ? `?${new URLSearchParams(filters).toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${query}`);
  if (!res.ok) throw new Error(`${category} fetch failed: ${res.status}`);
  return res.json();
}

export async function createMarketplaceListing(category: MarketplaceCategory, payload: Record<string, unknown>, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function addMarketplaceMedia(category: MarketplaceCategory, listingId: string, url: string, mediaType: "PHOTO" | "VIDEO", accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${listingId}/add-media/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ url, media_type: mediaType }),
  });
  if (!res.ok) {
    const data = await res.json();
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Could not attach media"));
  }
  return res.json();
}

export type MarketplaceAvailability = "AVAILABLE" | "UNDER_OFFER" | "UNAVAILABLE";

// Everything the caller posted in one category, including sold or paused listings the public list hides.
export async function listMyMarketplaceListings<T>(category: MarketplaceCategory, accessToken: string): Promise<{ count: number; results: T[] }> {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/mine/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load your ${category}`);
  return res.json();
}

export async function updateMarketplaceListing(category: MarketplaceCategory, id: string, payload: Record<string, unknown>, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Could not update the listing"));
  }
  return data;
}

export async function setMarketplaceListingStatus(category: MarketplaceCategory, id: string, status: MarketplaceAvailability, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/set-status/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not change the listing status");
  return data;
}

export async function deleteMarketplaceListing(category: MarketplaceCategory, id: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not delete the listing");
}

export type MarketplaceOrderStatus = "PAID" | "HANDED_OVER" | "COMPLETED" | "CANCELLED" | "DISPUTED";

export interface MarketplaceOrderItem {
  id: string;
  listing_id: string;
  listing_title: string;
  category: MarketplaceCategory | "";
  buyer: string;
  buyer_name: string;
  seller: string;
  seller_name: string;
  amount_xaf: string;
  status: MarketplaceOrderStatus;
  handed_over_at: string | null;
  completed_at: string | null;
  created_at: string;
  auto_release_at: string | null;
  seller_deadline: string | null;
}

async function marketplaceOrderResponse(res: Response, fallback: string): Promise<MarketplaceOrderItem> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : fallback));
  }
  return data;
}

export async function placeMarketplaceOrder(category: MarketplaceCategory, listingId: string, phoneNumber: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ category, listing_id: listingId, phone_number: phoneNumber }),
  });
  return marketplaceOrderResponse(res, "Could not place the order");
}

export async function listMyMarketplaceOrders(role: "buying" | "selling", accessToken: string): Promise<{ count: number; results: MarketplaceOrderItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/?role=${role}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error("Could not load your orders");
  return res.json();
}

export async function marketplaceOrderAction(orderId: string, action: "hand-over" | "confirm" | "cancel" | "decline" | "dispute", accessToken: string, reason?: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/${orderId}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(action === "dispute" ? { reason } : {}),
  });
  return marketplaceOrderResponse(res, "That action could not be completed");
}

export async function getMarketplaceListing<T>(category: MarketplaceCategory, id: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Not found: ${res.status}`);
  return res.json();
}

export interface RideBookingItem {
  id: string;
  rider: string;
  rider_name: string;
  driver: string | null;
  driver_name: string | null;
  vehicle: number | null;
  vehicle_details: { vehicle_category: string; make: string; model: string; plate_number: string } | null;
  pickup_description: string;
  pickup_latitude?: string | number | null;
  pickup_longitude?: string | number | null;
  dropoff_description: string;
  dropoff_latitude?: string | number | null;
  dropoff_longitude?: string | number | null;
  fare_estimate_xaf: string;
  distance_km: string | null;
  status: string;
  ride_category: string;
  transport_type: string;
  has_luggage: boolean;
  cargo_description: string;
  requested_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// My Bookings and real dispute-opening. The real gap this closes:
// open_dispute() existed, fully built (real SLA deadlines, flips the
// escrow to DISPUTED), but was never called from anywhere reachable
// — a real person whose payment went wrong had no way to raise it.
// ---------------------------------------------------------------------------
export interface BookingItem {
  id: string;
  booking_type: string;
  target_content_type: string;
  target_id: string;
  status: string;
  amount_xaf: string;
  has_escrow: boolean;
  escrow_status: "HELD" | "RELEASED" | "REFUNDED" | "DISPUTED" | null;
  dispute_status: "OPEN" | "ADMIN_RESPONDED" | "RESOLVED" | "ESCALATED" | null;
  dispute_resolution_notes: string;
  dispute_id?: string | null;
  target_owner?: string | null;
  target_owner_name?: string | null;
  hold_expires_at: string | null;
  created_at: string;
}

export async function listMyBookings(accessToken: string): Promise<PaginatedResponse<BookingItem>> {
  const res = await fetch(`${API_BASE_URL}/api/bookings/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch bookings");
  return res.json();
}

export async function createGenericBooking(
  payload: {
    booking_type: string;
    target_content_type: string;
    target_id: string;
    amount_xaf: string | number;
  },
  accessToken: string
): Promise<BookingItem> {
  const res = await fetch(`${API_BASE_URL}/api/bookings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

export async function payGenericBooking(
  bookingId: string,
  phoneNumber: string,
  accessToken: string
): Promise<BookingItem> {
  const res = await fetch(`${API_BASE_URL}/api/bookings/${bookingId}/pay/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

export async function payReservation(
  reservationId: string,
  phoneNumber: string,
  accessToken: string
): Promise<Reservation> {
  const res = await fetch(`${API_BASE_URL}/api/reservations/${reservationId}/pay/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

export async function openDispute(bookingId: string, reason: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/bookings/${bookingId}/open-dispute/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ reason }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not open a dispute");
  return data;
}

export async function cancelBooking(bookingId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/bookings/${bookingId}/cancel/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not cancel this booking");
  return data;
}

// ---------------------------------------------------------------------------
// In-App Wallet & Mobile Money Disbursal (MTN MoMo / Orange Money Payouts)
// ---------------------------------------------------------------------------
export interface WalletTransactionItem {
  id: string;
  transaction_type: string;
  amount_xaf: string;
  platform_fee_xaf: string;
  related_reference: string;
  created_at: string;
}

export interface WithdrawalRequestItem {
  id: string;
  amount_xaf: string;
  status: string;
  requested_at: string;
  resolved_at: string | null;
}

export interface WalletDetail {
  balance_xaf: string;
  transactions: WalletTransactionItem[];
  withdrawals: WithdrawalRequestItem[];
}

export async function getMyWallet(accessToken: string): Promise<WalletDetail> {
  const res = await fetch(`${API_BASE_URL}/api/wallet/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not fetch wallet");
  return res.json();
}

export async function withdrawWallet(
  payload: { amount_xaf: number | string; phone_number?: string; provider?: string },
  accessToken: string
): Promise<{ detail: string; withdrawal_id: string; amount_xaf: string; status: string; balance_xaf: string }> {
  const res = await fetch(`${API_BASE_URL}/api/wallet/withdraw/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Withdrawal failed");
  return data;
}

export async function rechargeWallet(amountXaf: string, phoneNumber: string, accessToken: string): Promise<WalletDetail> {
  const res = await fetch(`${API_BASE_URL}/api/wallet/recharge/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ amount_xaf: amountXaf, phone_number: phoneNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Recharge failed");
  return data;
}

// ---------------------------------------------------------------------------
// Gift economy — send a gift, view received gifts, cash them out.
// ---------------------------------------------------------------------------
export interface GiftItem {
  id: string;
  sender: string;
  sender_name: string;
  recipient: string;
  recipient_name: string;
  gift_type: "ROSE" | "HOUSE_KEY" | "DIAMOND";
  point_value: number;
  post: string | null;
  converted_to_wallet: boolean;
  sent_at: string;
}

export async function sendGift(recipientId: string, giftType: string, postId: string | undefined, accessToken: string): Promise<GiftItem> {
  const res = await fetch(`${API_BASE_URL}/api/gifts/send/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ recipient: recipientId, gift_type: giftType, post: postId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not send gift");
  return data;
}

export async function getMyGifts(accessToken: string): Promise<{ unconverted_points: number; results: GiftItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/gifts/mine/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch gifts");
  return res.json();
}

export async function convertGiftsToWalletBalance(accessToken: string): Promise<{ converted_xaf: string; balance_xaf: string }> {
  const res = await fetch(`${API_BASE_URL}/api/gifts/convert/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not convert gifts");
  return data;
}

// ---------------------------------------------------------------------------
// Ad campaign boosting — Facebook-style, per placement/duration.
// ---------------------------------------------------------------------------
export interface AdCampaignItem {
  id: string;
  owner: string;
  placement: string;
  duration_unit: string;
  duration_quantity: number;
  budget_xaf: string;
  spent_so_far_xaf: string;
  target_quarter: number | null;
  target_property_type: string;
  starts_at: string;
  ends_at: string;
  status: string;
}

export async function getBoostPriceQuote(placement: string, durationUnit: string, durationQuantity: number, accessToken: string): Promise<{ total_price_xaf: string }> {
  const res = await fetch(`${API_BASE_URL}/api/ad-campaigns/quote/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ placement, duration_unit: durationUnit, duration_quantity: durationQuantity }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not get a price quote");
  return data;
}

export async function purchaseCampaignBoost(
  payload: { placement: string; duration_unit: string; duration_quantity: number; phone_number: string; target_listing_id?: string; target_post?: string },
  accessToken: string,
): Promise<AdCampaignItem> {
  const res = await fetch(`${API_BASE_URL}/api/ad-campaigns/purchase/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not purchase this boost");
  return data;
}

export async function getMyAdCampaigns(accessToken: string): Promise<{ count: number; results: AdCampaignItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-ad-campaigns/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch your ad campaigns");
  return res.json();
}

// ---------------------------------------------------------------------------
// AI support chatbot — grounded in real platform data (engagement.support_agent).
// ---------------------------------------------------------------------------
export interface SupportMessageItem {
  id: number;
  sender_type: "USER" | "AI_AGENT" | "HUMAN_AGENT";
  text: string;
  sent_at: string;
}

export interface SupportTicketItem {
  id: string;
  subject: string;
  status: string;
  ai_handled: boolean;
  created_at: string;
  messages?: SupportMessageItem[];
}

export async function listMySupportTickets(accessToken: string): Promise<{ count: number; results: SupportTicketItem[] }> {
  const res = await fetchWithAutoRefresh(`${API_BASE_URL}/api/support-tickets/`, {}, accessToken);
  if (!res.ok) throw new Error("Could not fetch your support conversations");
  return res.json();
}

export async function startSupportChat(message: string, accessToken: string): Promise<SupportTicketItem> {
  const res = await fetchWithAutoRefresh(`${API_BASE_URL}/api/support-tickets/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }, accessToken);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not start a chat with support");
  return data;
}

export async function continueSupportChat(ticketId: string, message: string, accessToken: string): Promise<SupportTicketItem> {
  const res = await fetchWithAutoRefresh(`${API_BASE_URL}/api/support-tickets/${ticketId}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }, accessToken);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not send your message");
  return data;
}

export interface AnonymousChatReply {
  response_text: string;
  should_escalate_to_human: boolean;
}

// No sign-in required — nothing is persisted server-side, so the
// caller must hold its own conversation_history and resend it each
// turn (same {sender_type, text} shape used inside SupportTicketItem).
export async function askChatbotAnonymously(
  message: string,
  conversationHistory: { sender_type: string; text: string }[],
): Promise<AnonymousChatReply> {
  const res = await fetch(`${API_BASE_URL}/api/chatbot/ask/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversation_history: conversationHistory }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not reach Oazi right now.");
  return data;
}

// ---------------------------------------------------------------------------
// Parent/guardian portal — consent-gated, read-only.
// ---------------------------------------------------------------------------
export interface ParentAccessGrantItem {
  id: string;
  parent_user: string;
  parent_name: string;
  student: string;
  student_name: string;
  also_notify_institution: boolean;
  consented_at: string;
  revoked_at: string | null;
}

export async function grantParentAccess(parentUserId: string, alsoNotifyInstitution: boolean, accessToken: string): Promise<ParentAccessGrantItem> {
  const res = await fetch(`${API_BASE_URL}/api/my-parent-access-grants/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ parent_user_id: parentUserId, also_notify_institution: alsoNotifyInstitution }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not grant access");
  return data;
}

export async function getMyParentAccessGrants(accessToken: string): Promise<ParentAccessGrantItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/my-parent-access-grants/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch access grants");
  return res.json();
}

export async function revokeParentAccess(grantId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-parent-access-grants/?grant_id=${grantId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not revoke access");
  return data;
}

export async function getMyGuardianAccesses(accessToken: string): Promise<ParentAccessGrantItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/my-guardian-accesses/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch your accessible students");
  return res.json();
}

export interface ParentPortalData {
  bills: { id: number; amount_xaf: string; due_date: string; status: string }[];
  welfare_status: "HAS_OPEN_ALERT" | "NO_OPEN_ALERTS";
}

export async function getParentPortalData(studentId: string, accessToken: string): Promise<ParentPortalData> {
  const res = await fetch(`${API_BASE_URL}/api/parent-portal/${studentId}/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not fetch this student's data");
  return data;
}

export async function listMyRides(accessToken: string): Promise<{ count: number; results: RideBookingItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/rides/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch rides");
  return res.json();
}

export async function requestRide(
  payload: {
    pickup_description: string;
    dropoff_description: string;
    distance_km: string;
    pickup_latitude?: number | string | null;
    pickup_longitude?: number | string | null;
    dropoff_latitude?: number | string | null;
    dropoff_longitude?: number | string | null;
    ride_category?: string;
    transport_type?: string;
    has_luggage?: boolean;
    cargo_description?: string;
  },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/rides/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not request ride");
  return data;
}

export async function acceptRide(rideId: string, vehicleId: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/accept/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ vehicle_id: vehicleId }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not accept ride");
  return res.json();
}

// ---------------------------------------------------------------------------
// OaziGo — real driver and vehicle registration. The real gap this
// closes: previously any signed-in user could accept a ride with no
// registration or vetting at all.
// ---------------------------------------------------------------------------
export interface DriverProfileItem {
  id: number;
  user_name: string;
  license_number: string;
  is_verified: boolean;
  vehicles: VehicleItem[];
}

export async function getMyDriverProfile(accessToken: string): Promise<DriverProfileItem | null> {
  const res = await fetch(`${API_BASE_URL}/api/my-driver-profile/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not fetch driver profile");
  return res.json();
}

export async function registerAsDriver(licenseNumber: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-driver-profile/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ license_number: licenseNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not register as a driver");
  return data;
}

export async function listDriversForAdmin(accessToken: string): Promise<PaginatedResponse<DriverProfileItem>> {
  const res = await fetch(`${API_BASE_URL}/api/admin/drivers/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch pending drivers");
  return res.json();
}

export async function verifyDriver(driverId: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/admin/drivers/${driverId}/verify/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res;
}

export interface VehicleItem {
  id: number;
  vehicle_category: string;
  make: string;
  model: string;
  plate_number: string;
}

export async function listMyVehicles(accessToken: string): Promise<{ count: number; results: VehicleItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-vehicles/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch vehicles");
  return res.json();
}

export async function registerVehicle(
  payload: { vehicle_category: string; make: string; model: string; plate_number: string },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/my-vehicles/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not register vehicle");
  return data;
}

export async function startRide(rideId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/start/`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not start ride");
  return res.json();
}

async function postRideAction(rideId: string, action: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/${action}/`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Action failed");
  return data;
}
export const cancelRide = (rideId: string, accessToken: string) => postRideAction(rideId, "cancel", accessToken);
export const releaseRide = (rideId: string, accessToken: string) => postRideAction(rideId, "release", accessToken);

export interface EmergencyContact {
  name: string;
  phone: string;
}

export async function getMyEmergencyContact(accessToken: string): Promise<EmergencyContact | null> {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not load your emergency contact");
  return res.json();
}

export async function saveMyEmergencyContact(contact: EmergencyContact, accessToken: string): Promise<EmergencyContact> {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(contact),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Could not save the contact"));
  }
  return data;
}

export async function deleteMyEmergencyContact(accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not remove the contact");
}

export async function raiseRideSos(
  rideId: string,
  accessToken: string,
  coords?: { latitude: number; longitude: number },
): Promise<{ sos_raised_at: string; admins_alerted: number; emergency_contact_alerted: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/sos/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(coords ? { latitude: coords.latitude.toFixed(7), longitude: coords.longitude.toFixed(7) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not raise the SOS");
  return data;
}

export interface MyRoomAllocationItem {
  id: string;
  unit: string;
  bed_slot: string;
  semester: string;
  status: string;
  allocated_at: string;
}

export async function listMyRoomAllocations(accessToken: string): Promise<{ count: number; results: MyRoomAllocationItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-room-allocations/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not fetch room allocations");
  return res.json();
}

export async function completeRide(rideId: string, phoneNumber: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/complete/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not complete ride");
  return res.json();
}

// ---------------------------------------------------------------------------
// Taskln Service — real on-demand technician dispatch (branded
// "Taskln Service" in the UI; the backend app is called "services").
// ---------------------------------------------------------------------------
export interface ServiceRequestPhoto {
  id: number;
  photo_type: "BEFORE" | "AFTER";
  file_url: string;
  uploaded_at: string;
}

export interface ServiceJobReview {
  score: number;
  comment: string;
}

export interface ServiceRequestItem {
  id: string;
  requester: string;
  requester_name: string;
  technician: string | null;
  technician_name: string | null;
  requested_technician?: string | null;
  requested_technician_name?: string | null;
  distance_km?: number | null;
  quote_deadline?: string | null;
  work_completed_at?: string | null;
  technician_overdue?: boolean;
  auto_release_at?: string | null;
  requester_rating?: { average: number | null; count: number };
  my_review?: ServiceJobReview | null;
  their_review?: ServiceJobReview | null;
  category: string;
  priority: string;
  status: string;
  description: string;
  quarter: string | null;
  quarter_name: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  address_note?: string;
  area_label?: string;
  quoted_amount_xaf: string | null;
  quoted_labor_xaf: string | null;
  quoted_materials_xaf: string | null;
  quote_approved: boolean;
  dispute_reason: string;
  dispute_resolution: "" | "RESUME" | "REASSIGN" | "CANCEL";
  dispute_resolution_notes: string;
  escrow_funded: boolean;
  technician_location: { latitude: string; longitude: string; recorded_at: string } | null;
  requested_at: string;
  accepted_at: string | null;
  en_route_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  scheduled_for: string | null;
  photos: ServiceRequestPhoto[];
}

export type ServiceRequestScope = "mine" | "jobs" | "board";

export async function listMyServiceRequests(
  accessToken: string,
  options: { scope?: ServiceRequestScope; radiusKm?: string; page?: number } = {},
): Promise<{ count: number; next: string | null; results: ServiceRequestItem[] }> {
  const params = new URLSearchParams();
  if (options.scope) params.set("scope", options.scope);
  if (options.radiusKm) params.set("radius_km", options.radiusKm);
  if (options.page && options.page > 1) params.set("page", String(options.page));
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch service requests");
  return res.json();
}

export async function createServiceRequest(
  payload: {
    category: string;
    description: string;
    quarter?: string;
    priority?: string;
    scheduled_for?: string;
    requested_technician?: string;
    address_note?: string;
    area_label?: string;
    photo_urls?: string[];
    latitude?: number | string | null;
    longitude?: number | string | null;
  },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Could not create service request"));
  }
  return data;
}

export async function acceptServiceRequest(id: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/accept/`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not accept request");
  return res.json();
}

export async function cancelServiceRequest(id: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/cancel/`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not cancel request");
  return res.json();
}

export async function startServiceRequest(id: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/start/`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not start request");
  return res.json();
}

export async function completeServiceRequest(id: string, phoneNumber: string | undefined, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/complete/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(phoneNumber ? { phone_number: phoneNumber } : {}),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not complete request");
  return res.json();
}

export async function fundServiceRequest(id: string, phoneNumber: string, accessToken: string): Promise<ServiceRequestItem> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/fund/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not pay into escrow");
  return data;
}

async function postServiceRequestAction(id: string, action: string, accessToken: string, body?: object): Promise<ServiceRequestItem> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Action failed"));
  }
  return data;
}

export const releaseServiceRequest = (id: string, token: string) => postServiceRequestAction(id, "release", token);
export const declineServiceRequest = (id: string, token: string) => postServiceRequestAction(id, "decline", token);
export const openServiceRequestToAll = (id: string, token: string) => postServiceRequestAction(id, "open-to-all", token);
export const markServiceRequestEnRoute = (id: string, token: string, location?: { latitude: number; longitude: number }) =>
  postServiceRequestAction(id, "en-route", token, location);
export const proposeServiceQuote = (id: string, quote: { amountXaf: string } | { laborXaf: string; materialsXaf?: string }, token: string) =>
  postServiceRequestAction(id, "quote", token, "amountXaf" in quote
    ? { amount_xaf: quote.amountXaf }
    : { labor_xaf: quote.laborXaf, ...(quote.materialsXaf ? { materials_xaf: quote.materialsXaf } : {}) });

export interface ServiceReceipt {
  receipt_number: string;
  category_code: string;
  category: string;
  description: string;
  requester_name: string;
  technician_name: string | null;
  completed_at: string | null;
  labor_xaf: string | null;
  materials_xaf: string | null;
  total_xaf: string | null;
  platform_fee_xaf: string | null;
  technician_payout_xaf: string | null;
}

export async function getServiceReceipt(id: string, accessToken: string): Promise<ServiceReceipt> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/receipt/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not load the receipt");
  return data;
}
export const approveServiceQuote = (id: string, token: string) => postServiceRequestAction(id, "approve-quote", token);
export const rejectServiceQuote = (id: string, token: string) => postServiceRequestAction(id, "reject-quote", token);
export const markServiceWorkDone = (id: string, token: string) => postServiceRequestAction(id, "work-done", token);
export const dismissServiceTechnician = (id: string, token: string) => postServiceRequestAction(id, "dismiss-technician", token);
export const rescheduleServiceRequest = (id: string, scheduledFor: string, token: string) =>
  postServiceRequestAction(id, "reschedule", token, { scheduled_for: scheduledFor });

export interface ServiceRequestMessageItem {
  id: number;
  sender: string;
  sender_name: string;
  text: string;
  created_at: string;
}

export async function listServiceRequestMessages(id: string, accessToken: string): Promise<ServiceRequestMessageItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/messages/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not load messages");
  return res.json();
}

export async function sendServiceRequestMessage(id: string, text: string, accessToken: string): Promise<ServiceRequestMessageItem> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/messages/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not send the message");
  return data;
}
export const disputeServiceRequest = (id: string, reason: string, token: string) =>
  postServiceRequestAction(id, "dispute", token, { reason });
export const rateServiceTechnician = (id: string, score: number, token: string, comment = "") =>
  postServiceRequestAction(id, "rate", token, { score, comment });
export const rateServiceRequester = (id: string, score: number, token: string, comment = "") =>
  postServiceRequestAction(id, "rate-requester", token, { score, comment });

export interface TechnicianDirectoryItem {
  user_id: string;
  name: string;
  profile_image_url: string;
  specialties: string[];
  portfolio_urls: string[];
  quarter_name: string | null;
  avg_rating: number;
  completed_jobs: number;
}

export async function listTechnicianDirectory(specialty?: string, userId?: string): Promise<TechnicianDirectoryItem[]> {
  const params = new URLSearchParams();
  if (specialty) params.set("specialty", specialty);
  if (userId) params.set("user_id", userId);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/technicians/${query}`);
  if (!res.ok) throw new Error("Could not load technicians");
  return res.json();
}

export async function uploadServiceRequestPhoto(id: string, photoType: "BEFORE" | "AFTER", fileUrl: string, accessToken: string): Promise<ServiceRequestPhoto> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/upload-photo/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ photo_type: photoType, file_url: fileUrl }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not upload photo");
  return data;
}

export async function submitTechnicianLocationPing(latitude: number, longitude: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-location/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ latitude, longitude }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not share your location");
  return data;
}

export interface TechnicianAvailabilitySlotItem {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export async function getMyTechnicianAvailability(accessToken: string): Promise<TechnicianAvailabilitySlotItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-availability/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch availability");
  return res.json();
}

export async function setMyTechnicianAvailability(slots: TechnicianAvailabilitySlotItem[], accessToken: string): Promise<TechnicianAvailabilitySlotItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-availability/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ slots }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not save availability");
  return data;
}

export interface TechnicianDashboardData {
  active_job_count: number;
  active_jobs: { id: string; category: string; priority: string }[];
  completed_job_count: number;
  wallet_balance_xaf: string;
  recent_transaction_count: number;
  jobs_trend: { current_period_value: number; previous_period_value: number; percent_change: number | null };
}

export async function getMyTechnicianDashboard(accessToken: string): Promise<TechnicianDashboardData> {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-dashboard/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch dashboard");
  return res.json();
}

// ---------------------------------------------------------------------------
// Facility Management Contracts & Project Management Cases (docs/01 §2.4)
// ---------------------------------------------------------------------------
export interface FacilityVisitLogItem {
  id: string;
  logged_by: string;
  logged_by_name: string;
  notes: string;
  photo_url: string;
  visited_at: string;
}

export interface FacilityContractItem {
  id: string;
  owner: string;
  target_content_type: string;
  target_id: string;
  technician: string | null;
  technician_name: string | null;
  agency: number | null;
  agency_name: string | null;
  scope: string;
  frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY";
  start_date: string;
  is_active: boolean;
  created_at: string;
  visit_logs: FacilityVisitLogItem[];
}

export async function listFacilityContracts(accessToken: string): Promise<{ count: number; results: FacilityContractItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/facility-contracts/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch facility contracts");
  return res.json();
}

export async function createFacilityContract(
  payload: { target_content_type: string; target_id: string; scope: string; frequency: string; start_date: string; technician?: string },
  accessToken: string,
) {
  const res = await fetch(`${API_BASE_URL}/api/facility-contracts/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not create facility contract");
  return data;
}

export async function logFacilityVisit(contractId: string, notes: string, accessToken: string): Promise<FacilityVisitLogItem> {
  const res = await fetch(`${API_BASE_URL}/api/facility-contracts/${contractId}/log-visit/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ notes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not log this visit");
  return data;
}

export interface ProjectMilestoneItem {
  id: string;
  case: string;
  title: string;
  budget_allocation_xaf: string;
  due_date: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  completed_at: string | null;
}

export interface ProjectCaseItem {
  id: string;
  owner: string;
  title: string;
  description: string;
  budget_xaf: string;
  status: "PLANNING" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
  target_content_type: string;
  target_id: string | null;
  technicians: string[];
  technician_names: string[];
  milestones: ProjectMilestoneItem[];
  created_at: string;
}

export async function listProjectCases(accessToken: string): Promise<{ count: number; results: ProjectCaseItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/project-cases/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch project cases");
  return res.json();
}

export async function createProjectCase(payload: { title: string; description: string; budget_xaf: string }, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/project-cases/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not create project case");
  return data;
}

export async function linkProjectTechnician(caseId: string, technicianId: string, accessToken: string): Promise<ProjectCaseItem> {
  const res = await fetch(`${API_BASE_URL}/api/project-cases/${caseId}/link-technician/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ technician: technicianId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not link this technician");
  return data;
}

export async function addProjectMilestone(
  caseId: string, payload: { title: string; budget_allocation_xaf: string; due_date?: string }, accessToken: string,
): Promise<ProjectMilestoneItem> {
  const res = await fetch(`${API_BASE_URL}/api/project-cases/${caseId}/add-milestone/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not add milestone");
  return data;
}

export async function completeProjectMilestone(caseId: string, milestoneId: string, accessToken: string): Promise<ProjectMilestoneItem> {
  const res = await fetch(`${API_BASE_URL}/api/project-cases/${caseId}/complete-milestone/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ milestone_id: milestoneId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not complete milestone");
  return data;
}

export interface TechnicianProfileItem {
  id: number;
  user_name: string;
  specialties: string[];
  coverage_quarter: string | null;
  quarter_name: string | null;
  avg_rating: string;
  is_verified: boolean;
  rejection_reason: string;
  credential_urls: string[];
  portfolio_urls: string[];
  created_at: string;
}

export async function saveTechnicianDocuments(credentialUrls: string[], portfolioUrls: string[], accessToken: string): Promise<TechnicianProfileItem> {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-documents/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ credential_urls: credentialUrls, portfolio_urls: portfolioUrls }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not save documents");
  return data;
}

export async function getMyTechnicianProfile(accessToken: string): Promise<TechnicianProfileItem | null> {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-profile/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not fetch technician profile");
  return res.json();
}

export async function registerAsTechnician(specialties: string[], coverageQuarter: string | undefined, accessToken: string): Promise<TechnicianProfileItem> {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-profile/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ specialties, coverage_quarter: coverageQuarter || undefined }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not register as a technician");
  return data;
}

export async function listTechniciansForAdmin(accessToken: string, status: "pending" | "verified" | "rejected" = "pending"): Promise<PaginatedResponse<TechnicianProfileItem>> {
  const res = await fetch(`${API_BASE_URL}/api/admin/technicians/?status=${status}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch technicians");
  return res.json();
}

export async function verifyTechnician(technicianId: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/admin/technicians/${technicianId}/verify/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res;
}

export async function reviewTechnician(technicianId: number, action: "reject" | "revoke", reason: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/technicians/${technicianId}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ reason }),
  });
}

export interface AdminServiceDisputeItem {
  id: string;
  requester: string;
  requester_name: string;
  technician: string | null;
  technician_name: string | null;
  category: string;
  description: string;
  status: string;
  dispute_reason: string;
  quoted_amount_xaf: string | null;
  quote_approved: boolean;
  requested_at: string;
  started_at: string | null;
  escrow_funded: boolean;
  messages: { id: number; sender_name: string; text: string; created_at: string }[];
}

export type ServiceDisputeOutcome = "RESUME" | "REASSIGN" | "CANCEL";

export async function listAdminServiceDisputes(accessToken: string): Promise<AdminServiceDisputeItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/admin/service-disputes/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch job disputes");
  return res.json();
}

export async function resolveAdminServiceDispute(id: string, outcome: ServiceDisputeOutcome, notes: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/service-disputes/${id}/resolve/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ outcome, notes }),
  });
}

// ---------------------------------------------------------------------------
// Direct chat, ride chat, dispute mediation chat, greetings, referrals
// ---------------------------------------------------------------------------
export async function getOrCreateConversation(participantId: string, accessToken: string): Promise<ConversationSummary> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ participant_id: participantId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not open the conversation");
  return data;
}

export interface ChatMessageItem {
  id: number;
  sender: string;
  sender_name: string;
  text: string;
  created_at: string;
}

export type RideMessageItem = ChatMessageItem;
export type DisputeMessageItem = ChatMessageItem;

async function listChatMessages(path: string, accessToken: string): Promise<ChatMessageItem[]> {
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not load messages");
  return res.json();
}

async function sendChatMessage(path: string, text: string, accessToken: string): Promise<ChatMessageItem> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not send the message");
  return data;
}

export const listRideMessages = (rideId: string, token: string) => listChatMessages(`/api/rides/${rideId}/messages/`, token);
export const sendRideMessage = (rideId: string, text: string, token: string) => sendChatMessage(`/api/rides/${rideId}/messages/`, text, token);
export const listDisputeMessages = (disputeId: string, token: string) => listChatMessages(`/api/disputes/${disputeId}/messages/`, token);
export const sendDisputeMessage = (disputeId: string, text: string, token: string) => sendChatMessage(`/api/disputes/${disputeId}/messages/`, text, token);

export interface AdminGreetingSettings {
  birthday_enabled: boolean;
  birthday_title: string;
  birthday_message: string;
  new_month_enabled: boolean;
  new_month_title: string;
  new_month_message: string;
  listing_share_message: string;
  updated_at?: string;
}

let shareMessagePromise: Promise<string> | null = null;

/** Admin-editable WhatsApp share template; fetched once per page load and shared by every card. */
export function getListingShareMessage(): Promise<string> {
  if (!shareMessagePromise) {
    shareMessagePromise = fetch(`${API_BASE_URL}/api/listing-share-message/`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("share message unavailable"))))
      .then((data) => data.listing_share_message as string)
      .catch((err) => {
        shareMessagePromise = null;
        throw err;
      });
  }
  return shareMessagePromise;
}

export async function getAdminGreetingSettings(accessToken: string): Promise<AdminGreetingSettings> {
  const res = await fetch(`${API_BASE_URL}/api/admin/greeting-settings/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not load greeting settings");
  return res.json();
}

export async function updateAdminGreetingSettings(settings: AdminGreetingSettings, accessToken: string): Promise<AdminGreetingSettings> {
  const res = await fetch(`${API_BASE_URL}/api/admin/greeting-settings/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(settings),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not save greeting settings");
  return data;
}

export interface ReferralItem {
  id: number;
  referred_user: string;
  referred_user_name: string;
  referred_username: string;
  status: "PENDING" | "QUALIFIED" | "REWARDED";
  reward_earned_xaf: string;
  created_at: string;
}

export interface MyReferralsSummary {
  total_count: number;
  qualified_count: number;
  rewarded_count: number;
  total_reward_xaf: string | number;
  results: ReferralItem[];
}

export async function getMyReferrals(accessToken: string): Promise<MyReferralsSummary> {
  const res = await fetch(`${API_BASE_URL}/api/my-referrals/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not load your referrals");
  return res.json();
}

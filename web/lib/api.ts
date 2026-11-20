/**
 * lib/api.ts — the ONE place that knows the Django API's base URL and
 * shape. Every page calls through here rather than hardcoding fetch()
 * calls with the URL scattered across the codebase — if the API moves
 * or a header requirement changes, this is the only file that changes.
 */

// Server Components (SSR) and the browser need different URLs in dev:
// SSR runs inside the Next.js server process and can reach the Django
// server directly; the browser needs a URL it can actually resolve.
// In production these would both point at the same real public API domain;
// localhost is only a development fallback.
export const API_BASE_URL =
  typeof window === "undefined"
    ? process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
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
  // A staff session can't be refreshed: when it runs out, go back to the staff member's own account.
  if (localStorage.getItem(STAFF_SESSION_KEY)) {
    endStaffSession();
    throw new Error("Your staff session has ended.");
  }
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

// ---------------------------------------------------------------------------
// Staff access: an owner lets someone help on their account; the helper switches into a staff session.
// While it lasts, the site's normal "access_token" is the staff-session token (so every page works as the owner,
// within the limits) and the helper's own tokens wait under STAFF_SAVED_KEY.
// ---------------------------------------------------------------------------
export const STAFF_SESSION_KEY = "staff_session";
const STAFF_SAVED_KEY = "staff_saved_tokens";
export const STAFF_SESSION_EVENT = "oaziland-staff-session";

export type StaffPermission = "listings" | "messages" | "bookings" | "posts" | "reviews" | "earnings_view";
export const STAFF_PERMISSIONS: StaffPermission[] = ["listings", "messages", "bookings", "posts", "reviews", "earnings_view"];

export interface StaffPerson { id: string; username: string; name: string; profile_image_url: string }
export interface StaffGrant {
  id: string;
  owner: StaffPerson;
  staff: StaffPerson;
  title: string;
  permissions: StaffPermission[];
  status: "PENDING" | "ACTIVE" | "DECLINED" | "REVOKED";
  expires_on: string | null;
  invited_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  usable: boolean;
  i_am_owner: boolean;
}
export interface StaffSessionInfo {
  grantId: string; ownerName: string; ownerUsername: string; title: string; permissions: StaffPermission[]; expiresAt: number;
  /** "platform": an admin managing Oaziland's own offers (see startPlatformSession). */
  kind?: "staff" | "platform";
}

export function currentStaffSession(): StaffSessionInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const info = JSON.parse(localStorage.getItem(STAFF_SESSION_KEY) || "null") as StaffSessionInfo | null;
    return info && info.expiresAt > Date.now() ? info : null;
  } catch {
    return null;
  }
}

/** Leaves a staff session and puts the helper's own sign-in back. */
export function endStaffSession() {
  const saved = localStorage.getItem(STAFF_SAVED_KEY);
  if (saved) {
    try {
      const { access, refresh } = JSON.parse(saved) as { access: string; refresh: string };
      localStorage.setItem("access_token", access);
      if (refresh) localStorage.setItem("refresh_token", refresh);
    } catch {
      localStorage.removeItem("access_token");
    }
  }
  localStorage.removeItem(STAFF_SAVED_KEY);
  localStorage.removeItem(STAFF_SESSION_KEY);
  window.dispatchEvent(new Event(STAFF_SESSION_EVENT));
}

async function staffCall<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/staff-access/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiStatusError(data.detail || "Something went wrong. Please try again.", res.status);
  return data as T;
}

export const getStaffOverview = (accessToken: string) =>
  staffCall<{ can_have_staff: boolean; my_staff: StaffGrant[]; i_help: StaffGrant[] }>("", accessToken);

export const inviteStaff = (body: { identifier: string; permissions: StaffPermission[]; title?: string; expires_on?: string | null }, accessToken: string) =>
  staffCall<StaffGrant>("", accessToken, { method: "POST", body: JSON.stringify(body) });

export const staffAction = (
  grantId: string, action: "update" | "remove" | "accept" | "decline" | "leave", accessToken: string,
  body?: { permissions?: StaffPermission[]; title?: string; expires_on?: string | null },
) => staffCall<StaffGrant>(`${grantId}/${action}/`, accessToken, { method: "POST", body: JSON.stringify(body ?? {}) });

export const getStaffActivity = (grantId: string, accessToken: string) =>
  staffCall<{ results: { method: string; path: string; status_code: number; at: string }[] }>(`${grantId}/activity/`, accessToken);

/** Switches this browser into "Managing: <owner>". */
export async function startStaffSession(grantId: string, accessToken: string): Promise<StaffSessionInfo> {
  const data = await staffCall<StaffGrant & { access: string; expires_in: number }>(`${grantId}/switch/`, accessToken, { method: "POST" });
  const info: StaffSessionInfo = {
    grantId, ownerName: data.owner.name, ownerUsername: data.owner.username, title: data.title, permissions: data.permissions,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  localStorage.setItem(STAFF_SAVED_KEY, JSON.stringify({ access: accessToken, refresh: localStorage.getItem("refresh_token") || "" }));
  localStorage.setItem("access_token", data.access);
  localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(info));
  window.dispatchEvent(new Event(STAFF_SESSION_EVENT));
  return info;
}

/** Whether this admin may manage Oaziland's own offers (hotels, listings, store...) through a platform session. */
export async function getPlatformSessionStatus(accessToken: string): Promise<{ can_act: boolean; account?: { id: string; username: string; name: string } }> {
  const res = await fetch(`${API_BASE_URL}/api/platform-session/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) return { can_act: false };
  return res.json();
}

/** Switches this browser to Oaziland's own account for an hour, like a staff session: every normal page then
 * creates and manages things as Oaziland, and the admin's own sign-in waits until they switch back. */
export async function startPlatformSession(accessToken: string): Promise<StaffSessionInfo> {
  const res = await fetch(`${API_BASE_URL}/api/platform-session/`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiStatusError(data.detail || "Could not switch to Oaziland's account.", res.status);
  const info: StaffSessionInfo = {
    grantId: "platform", ownerName: data.account.name, ownerUsername: data.account.username, title: "", permissions: [],
    expiresAt: Date.now() + data.expires_in * 1000, kind: "platform",
  };
  localStorage.setItem(STAFF_SAVED_KEY, JSON.stringify({ access: accessToken, refresh: localStorage.getItem("refresh_token") || "" }));
  localStorage.setItem("access_token", data.access);
  localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(info));
  window.dispatchEvent(new Event(STAFF_SESSION_EVENT));
  return info;
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

export interface MyVerificationRequest {
  id: string;
  request_type: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submitted_at: string;
  reviewed_at: string | null;
  rejection_reason: string;
  supporting_document_url: string;
  subject: { kind: string; title: string; found: boolean };
}

export interface MyVerificationOption {
  request_type: string;
  subject_id: string;
  title: string;
  /** Latest request's status for this, or "" if never asked. */
  status: "" | "PENDING" | "APPROVED" | "REJECTED";
}

export async function getMyVerificationRequests(
  accessToken: string
): Promise<{ count: number; results: MyVerificationRequest[]; options: MyVerificationOption[] }> {
  const res = await fetch(`${API_BASE_URL}/api/verification-requests/`, {
    headers: { Authorization: "Bearer " + accessToken },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Verification requests fetch failed: ${res.status}`);
  return res.json();
}

export async function submitMyVerificationRequest(
  body: { request_type: string; subject_id: string; supporting_document_url: string },
  accessToken: string
) {
  return fetch(`${API_BASE_URL}/api/verification-requests/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
    body: JSON.stringify(body),
  });
}

export interface MyDataExport {
  id: string;
  status: "PENDING" | "READY" | "FAILED" | "EXPIRED";
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
  downloaded_at: string | null;
  downloadable: boolean;
}

export interface MyAccountDeletion {
  status: "NONE" | "REQUESTED" | "CANCELLED" | "COMPLETED" | "RETENTION_PERIOD";
  requested_at: string | null;
  scheduled_for: string | null;
  cancelled_at: string | null;
  cancelled_by_team: boolean;
  cancellation_reason: string;
  retention_days: number;
  /** What the user must type to confirm a deletion (their username). */
  confirmation_text: string;
  /** wallet_balance, pending_withdrawal, held_payment, open_dispute, open_sale */
  blockers: string[];
}

export async function listMyDataExports(accessToken: string): Promise<{ count: number; results: MyDataExport[] }> {
  const res = await fetch(`${API_BASE_URL}/api/data-exports/`, { headers: bearer(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Data exports fetch failed: ${res.status}`);
  return res.json();
}

export async function requestMyDataExport(accessToken: string) {
  return fetch(`${API_BASE_URL}/api/data-exports/`, { method: "POST", headers: bearer(accessToken) });
}

/** Downloads one of the caller's exports through the authenticated endpoint (there is no public file URL). */
export async function downloadMyDataExport(id: string, accessToken: string): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}/api/data-exports/${id}/download/`, { headers: bearer(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}

export async function getMyAccountDeletion(accessToken: string): Promise<MyAccountDeletion> {
  const res = await fetch(`${API_BASE_URL}/api/account/deletion/`, { headers: bearer(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Deletion status fetch failed: ${res.status}`);
  return res.json();
}

export async function requestMyAccountDeletion(password: string, reason: string, confirmation: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/account/deletion/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...bearer(accessToken) }, body: JSON.stringify({ password, reason, confirmation }),
  });
}

export async function cancelMyAccountDeletion(accessToken: string) {
  return fetch(`${API_BASE_URL}/api/account/deletion/`, { method: "DELETE", headers: bearer(accessToken) });
}

export async function getMyProfile(accessToken: string): Promise<UserProfile> {
  const res = await fetch(`${API_BASE_URL}/api/auth/me/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw Object.assign(new Error(`Profile fetch failed: ${res.status}`), { status: res.status });
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
  /** Videos only, read from the file's headers by the server. */
  duration_seconds?: number | null;
  video_codec?: "h264" | "hevc" | "other" | "";
}

// Mirrors the backend's upload rules (uploads/services.py) so problems surface before a long upload.
const UPLOAD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const UPLOAD_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const UPLOAD_IMAGE_LIMIT_MB = 10;
const UPLOAD_VIDEO_LIMIT_MB = 500;

export type MediaFileProblem = { code: "unsupported" } | { code: "tooLarge"; sizeMb: number; limitMb: number };

export function checkMediaFile(file: File): MediaFileProblem | null {
  const isImage = UPLOAD_IMAGE_TYPES.includes(file.type);
  const isVideo = UPLOAD_VIDEO_TYPES.includes(file.type);
  if (!isImage && !isVideo) return { code: "unsupported" };
  const limitMb = isImage ? UPLOAD_IMAGE_LIMIT_MB : UPLOAD_VIDEO_LIMIT_MB;
  if (file.size > limitMb * 1024 * 1024) return { code: "tooLarge", sizeMb: Math.ceil(file.size / 1024 / 1024), limitMb };
  return null;
}

/** True when a JWT access token has expired or is about to (so a long upload isn't started with it). */
function accessTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return false;
  }
}

type UploadReply = { status: number; data: { detail?: string } & Partial<MediaUploadResult> };

/** Sends one file via XMLHttpRequest (fetch can't report upload progress) and resolves with the server's reply. */
function sendMediaFile(
  file: File,
  folder: string,
  accessToken: string,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal },
): Promise<UploadReply> {
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
      let data: UploadReply["data"] = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error body (e.g. a proxy page) — fall through to the generic message
      }
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
}

/** Uploads one file; `signal` cancels it. An expired sign-in is refreshed first (so a large file isn't sent just to
 * be refused), and refreshed once more if the server still answers 401. */
export async function uploadMediaFile(
  file: File,
  folder: string,
  accessToken: string,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {}
): Promise<MediaUploadResult> {
  let token = accessToken;
  if (accessTokenExpired(token)) {
    const stored = localStorage.getItem("access_token");
    token = stored && !accessTokenExpired(stored) ? stored : await refreshOnce();
  }
  let reply = await sendMediaFile(file, folder, token, options);
  if (reply.status === 401) reply = await sendMediaFile(file, folder, await refreshOnce(), options);
  if (reply.status >= 200 && reply.status < 300) return reply.data as MediaUploadResult;
  throw new Error(reply.data.detail || "Upload failed");
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

export const MARKETPLACE_CONDITION_TARGETS = {
  warehouses: "marketplace.WarehouseListing",
  stores: "marketplace.StoreListing",
  businesses: "marketplace.BusinessListing",
  cars: "marketplace.CarListing",
  goods: "marketplace.GoodsListing",
} as const;

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
  // 204: posting empty conditions clears the listing's existing ones.
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const nested = Object.values(data.structured_conditions ?? {}).flat()[0];
    const firstFieldError = Object.values(data).flat()[0];
    const message = data.detail ?? (typeof nested === "string" ? nested : typeof firstFieldError === "string" ? firstFieldError : null);
    throw new Error(message || "Could not set listing conditions");
  }
  return data;
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
  name: string;
  category: string;
  capacity: number;
  base_rate_xaf: string;
  amenities?: string[];
  bed_setup?: string;
  size_sqm?: string | null;
  description?: string;
  photos: { id: number; url: string }[];
  /** Rooms of this type that can be sold (not out of order/service). */
  room_count: number;
  /** Owner view only. */
  is_active?: boolean;
  total_rooms?: number;
}

export interface HotelStayOption {
  room_type: string;
  rooms_free: number;
  nights: number;
  subtotal_xaf: string;
  length_of_stay_discount_xaf: string;
  last_minute_adjustment_applied: boolean;
  total_xaf: string;
}

/** Places whose rooms are booked through the hotel room-type engine. */
export type RoomTypePlaceEndpoint = "hotels" | "guest-houses";

/** Each room type's free rooms and exact price for the stay — the same price the reservation will charge. */
export async function getStayAvailability(
  endpoint: RoomTypePlaceEndpoint,
  placeId: string,
  checkIn: string,
  checkOut: string
): Promise<{ check_in: string; check_out: string; room_types: HotelStayOption[] }> {
  const params = new URLSearchParams({ check_in: checkIn, check_out: checkOut });
  const res = await fetch(`${API_BASE_URL}/api/${endpoint}/${placeId}/availability/?${params}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Availability check failed: ${res.status}`);
  return data;
}

export interface HotelRoomTypeInput {
  room_type?: string;
  name: string;
  category: string;
  capacity: number | string;
  base_rate_xaf: number | string;
  bed_setup?: string;
  size_sqm?: number | string | null;
  description?: string;
  amenities?: string[];
  room_count?: number | string;
}

async function roomTypeOwnerAction<T>(endpoint: RoomTypePlaceEndpoint, placeId: string, path: string, body: object, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/${endpoint}/${placeId}/${path}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed: ${res.status}`);
  return data;
}

/* Owner set-up of a hotel's or guest house's room types; each returns the place as its owner now sees it. */
export const saveRoomType = <T>(endpoint: RoomTypePlaceEndpoint, placeId: string, input: HotelRoomTypeInput, accessToken: string) =>
  roomTypeOwnerAction<T>(endpoint, placeId, "room-types", input, accessToken);
export const setRoomTypeVisibility = <T>(endpoint: RoomTypePlaceEndpoint, placeId: string, roomTypeId: string, isActive: boolean, accessToken: string) =>
  roomTypeOwnerAction<T>(endpoint, placeId, "room-type-visibility", { room_type: roomTypeId, is_active: isActive }, accessToken);
export const deleteRoomType = <T>(endpoint: RoomTypePlaceEndpoint, placeId: string, roomTypeId: string, accessToken: string) =>
  roomTypeOwnerAction<T>(endpoint, placeId, "delete-room-type", { room_type: roomTypeId }, accessToken);
export const addRoomTypePhoto = <T>(endpoint: RoomTypePlaceEndpoint, placeId: string, roomTypeId: string, url: string, accessToken: string) =>
  roomTypeOwnerAction<T>(endpoint, placeId, "room-type-photos", { room_type: roomTypeId, url }, accessToken);
export const removeRoomTypePhoto = <T>(endpoint: RoomTypePlaceEndpoint, placeId: string, roomTypeId: string, photoId: number, accessToken: string) =>
  roomTypeOwnerAction<T>(endpoint, placeId, "room-type-photos", { room_type: roomTypeId, remove: photoId }, accessToken);

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
  /** Cheapest nightly rate among the room types on offer. */
  from_price_xaf?: string | null;
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

export async function listHotelsForAdmin(accessToken: string, onlyUnverified = false): Promise<PaginatedResponse<Hotel>> {
  const res = await fetch(`${API_BASE_URL}/api/hotels/${onlyUnverified ? "?verified=false" : ""}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Hotel fetch failed: ${res.status}`);
  return res.json();
}

/** Every hotel the signed-in user owns (verified or not), in one unpaginated list. */
export async function listMyHotels(accessToken: string): Promise<Hotel[]> {
  const res = await fetch(`${API_BASE_URL}/api/hotels/?mine=1`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
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

export async function setHotelName(hotelId: string, name: string, accessToken: string): Promise<Hotel> {
  const res = await fetch(`${API_BASE_URL}/api/hotels/${hotelId}/set-name/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not update hotel name");
  return data;
}

export async function createHotel(
  payload: {
    quarter: string;
    name?: string;
    star_rating?: number;
    latitude?: number | string;
    longitude?: number | string;
    room_types: { name?: string; category: string; capacity: number; base_rate_xaf: string; room_count?: number }[];
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
  /** PENDING_PAYMENT until the payment provider confirms the money arrived, then CONFIRMED. */
  status: string;
  /** The payment's own progress while the guest approves it on their phone (PAYMENT_PROCESSING, PAYMENT_FAILED...). */
  payment_status?: string | null;
  special_requests: string;
  created_at: string;
  guest_house?: string | null;
  guest_name?: string;
  place_name?: string;
  place_kind?: "hotel" | "guest_house";
  place_id?: string;
  room_type_name?: string;
  /** The guest's payment is still held in escrow (not yet paid to the owner or refunded). */
  payment_held?: boolean;
  /** When the owner is paid automatically if nobody reports a problem. */
  payout_due_at?: string;
  /** What cancelling now would cost the guest; null when it can't be cancelled. */
  cancellation?: { free: boolean; free_until: string; fee_xaf: string; refund_xaf: string } | null;
}

export type StayActionName = "cancel" | "no-show" | "confirm-stay" | "dispute" | "check-in" | "checkout";

/** Follows every page of a reservations list, so a guest or host with many stays never loses the later ones. */
async function allReservations(firstUrl: string, accessToken: string, failure: string): Promise<Reservation[]> {
  const rows: Reservation[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; url && page < 50; page += 1) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (!res.ok) throw new Error(failure);
    const data = await res.json();
    rows.push(...(data.results ?? []));
    url = data.next ?? null;
  }
  return rows;
}

/** The signed-in user's own reservations (as a guest). */
export async function listMyReservations(accessToken: string): Promise<Reservation[]> {
  return allReservations(`${API_BASE_URL}/api/reservations/`, accessToken, "Could not load your stays");
}

/** Reservations made at the hotels / guest houses the user owns. */
export async function listHostingReservations(accessToken: string, place?: "hotel" | "guest_house"): Promise<Reservation[]> {
  const params = new URLSearchParams({ role: "hosting", ...(place ? { place } : {}) });
  return allReservations(`${API_BASE_URL}/api/reservations/?${params}`, accessToken, "Could not load reservations");
}

export async function stayAction(reservationId: string, action: StayActionName, accessToken: string, reason?: string) {
  const res = await fetch(`${API_BASE_URL}/api/reservations/${reservationId}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(action === "dispute" ? { reason } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "That could not be done");
  return data;
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

export async function listVenuesForAdmin(accessToken: string, onlyUnverified = false): Promise<PaginatedResponse<Venue>> {
  const res = await fetch(`${API_BASE_URL}/api/venues/${onlyUnverified ? "?verified=false" : ""}`, { headers: { Authorization: `Bearer ${accessToken}` } });
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

export type HostelPricePeriod = "MONTH" | "SEMESTER" | "YEAR";

/** What students browse and book in a hostel: a kind of room with its own photos, price and free places. */
export interface HostelRoomType {
  id: string;
  name: string;
  unit_type: string;
  occupancy_model: "PER_BED" | "PER_UNIT";
  beds_per_room: number;
  price_xaf: string;
  price_period: HostelPricePeriod;
  max_periods: number;
  size_sqm: string | null;
  private_bathroom: boolean;
  furnished: boolean;
  description: string;
  photos: { id: number; url: string }[];
  total_places: number;
  available_places: number;
}

export interface StudentHostel {
  id: string;
  name?: string;
  listed_by?: string | null;
  listed_by_name?: string | null;
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
  room_types?: HostelRoomType[];
  from_price?: { price_xaf: string; price_period: HostelPricePeriod } | null;
  description?: string;
  amenities?: string[];
}

export async function searchStudentHostels(): Promise<PaginatedResponse<StudentHostel>> {
  const res = await fetch(`${API_BASE_URL}/api/student-hostels/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Student hostel search failed: ${res.status}`);
  return res.json();
}

export async function createStudentHostel(
  payload: { quarter: string; name?: string; landlord?: string; property_type?: string; latitude?: number | string; longitude?: number | string },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/student-hostels/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : JSON.stringify(data));
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
  name?: string;
  is_coastal_leisure: boolean;
  quarter: string;
  quarter_name: string;
  finish_level: string;
  amenities: string[];
  photos: PropertyAssetPhotoItem[];
  latitude?: string | number | null;
  longitude?: string | number | null;
  description?: string;
  /** Rooms are booked through the same room-type engine as hotels. */
  total_rooms: number;
  room_types: RoomTypeSummary[];
  from_price_xaf?: string | null;
}

export async function setGuestHouseName(guestHouseId: string, name: string, accessToken: string): Promise<GuestHouse> {
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/${guestHouseId}/set-name/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not update the name");
  return data;
}

export type BookingSiteChannel = "AIRBNB" | "BOOKING_COM" | "EXPEDIA";

/** A booking site connected to a guest house by calendar link: what it blocks here, and the private Oaziland
 * calendar link the site should subscribe to so Oaziland bookings block nights there. */
export interface ChannelConnection {
  channel: BookingSiteChannel;
  channel_name: string;
  calendar_url: string;
  feed_url: string;
  last_synced_at: string | null;
  last_error: string;
  conflict_nights: string[];
}

async function channelRequest<T>(guestHouseId: string, action: string, accessToken: string, init?: { method: "GET" | "POST"; body?: object }): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/${guestHouseId}/${action}/`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail || "That could not be done");
  return data as T;
}

export const listChannelConnections = (guestHouseId: string, token: string) =>
  channelRequest<ChannelConnection[]>(guestHouseId, "channels", token);
export const connectChannel = (guestHouseId: string, channel: BookingSiteChannel, calendarUrl: string, token: string) =>
  channelRequest<{ result: { added: number; removed: number; conflicts: string[] }; channel: ChannelConnection }>(
    guestHouseId, "connect-channel", token, { method: "POST", body: { channel, calendar_url: calendarUrl } });
export const syncChannel = (guestHouseId: string, channel: BookingSiteChannel, token: string) =>
  channelRequest<{ result: { added: number; removed: number; conflicts: string[] }; channel: ChannelConnection }>(
    guestHouseId, "sync-channel", token, { method: "POST", body: { channel } });
export const disconnectChannel = (guestHouseId: string, channel: BookingSiteChannel, token: string) =>
  channelRequest<object>(guestHouseId, "disconnect-channel", token, { method: "POST", body: { channel } });
export const rotateChannelLink = (guestHouseId: string, channel: BookingSiteChannel, token: string) =>
  channelRequest<ChannelConnection>(guestHouseId, "rotate-channel-link", token, { method: "POST", body: { channel } });

/** Every guest house the signed-in user owns, in one unpaginated list. */
export async function listMyGuestHouses(accessToken: string): Promise<GuestHouse[]> {
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/?mine=1`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Guest house fetch failed: ${res.status}`);
  return res.json();
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
    name?: string;
    room_types?: { name: string; category: string; capacity: number; base_rate_xaf: string; room_count: number }[];
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

export interface AgentPublicProfile extends Partial<AgentProfileDetails> {
  full_name: string;
  is_kyc_verified: boolean;
  average_rating: number | null;
  rating_count: number;
  active_listing_count: number;
  agency_name: string | null;
  profile_image_url?: string;
  listings?: { count: number; results: AgentListingCard[]; next_offset: number | null };
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
  name?: string;
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
  name?: string;
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
  /** Professional roles (agent, agency, landlord) an admin has verified. */
  verified_roles?: string[];
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
export async function getRatingEligibility(subjectUserId: string, accessToken: string): Promise<{ can_rate: boolean; reason: string }> {
  const res = await fetch(`${API_BASE_URL}/api/ratings/?subject_user=${encodeURIComponent(subjectUserId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not check rating eligibility");
  return data;
}

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

/** Everything a report can be about. "listing" is a property or marketplace listing. */
export type ReportKind =
  | "listing" | "post" | "hotel" | "guest_house" | "venue" | "student_hostel" | "job_posting" | "comment"
  | "review" | "service_review" | "hostel_review" | "venue_review" | "caterer_review" | "agent_video";

export async function fileContentReport(kind: ReportKind, id: string, reason: string, notes: string, accessToken: string) {
  const target = kind === "listing" ? { target_listing_id: id } : kind === "post" ? { target_post: id } : { target_kind: kind, target_id: id };
  const res = await fetch(`${API_BASE_URL}/api/content-reports/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ ...target, reason, notes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not submit report");
  return data;
}

export type PlaceReviewKind = "hostel" | "venue";

export interface PlaceReview {
  id: string;
  author_id: string;
  author_name: string;
  score: number;
  text: string;
  created_at: string;
  /** Hostel: the room type the student had. Venue: the date of the event. */
  detail: string;
  is_mine: boolean;
}

export interface PlaceReviews {
  count: number;
  average: number | null;
  results: PlaceReview[];
  can_review: boolean;
  /** Why the viewer can't write one: sign_in, own_place, already_reviewed, no_stay or no_event. */
  cannot_review_reason: string;
}

const placeReviewsUrl = (kind: PlaceReviewKind, id: string) =>
  `${API_BASE_URL}/api/${kind === "hostel" ? "student-hostels" : "venues"}/${id}/reviews/`;

export async function getPlaceReviews(kind: PlaceReviewKind, id: string, accessToken?: string | null): Promise<PlaceReviews> {
  const res = await fetch(placeReviewsUrl(kind, id), {
    cache: "no-store",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new Error(`Reviews fetch failed: ${res.status}`);
  return res.json();
}

export async function addPlaceReview(kind: PlaceReviewKind, id: string, score: number, text: string, accessToken: string): Promise<PlaceReviews> {
  const res = await fetch(placeReviewsUrl(kind, id), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ score, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not save your review");
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

/** What the platform offers right now: admins can switch chat translation, SMS and email off. */
export interface PublicFeatures { chat_translation: boolean; sms: boolean; email: boolean }

/** Errs on the side of hiding translation (the paid feature) and showing the free channels when the server can't be reached. */
export async function getPublicFeatures(): Promise<PublicFeatures> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/features/`, { cache: "no-store" });
    if (!res.ok) throw new Error("features");
    return await res.json();
  } catch {
    return { chat_translation: false, sms: true, email: true };
  }
}

export interface ChatTranslation {
  text: string;
  source_language: string;
  target: string;
  /** The message was already in the reader's language, so there is nothing to translate. */
  same_language: boolean;
  provider: string;
  cached: boolean;
}

export async function translateChatMessage(conversationId: string, messageId: string, target: "en" | "fr", accessToken: string): Promise<ChatTranslation> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/messages/${messageId}/translate/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ target }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not translate this message");
  return data;
}

export interface AdminFeatureSettings {
  chat_translation_enabled: boolean;
  sms_enabled: boolean;
  email_enabled: boolean;
  /** Which translation provider is connected on the server (NONE until a key is set), and whether it is a test stand-in. */
  translation: { provider: "GOOGLE" | "AZURE" | "SANDBOX" | "NONE"; ready: boolean; test_mode: boolean };
  sms_connected: boolean;
  email_connected: boolean;
  updated_at: string;
}
export type AdminFeatureSwitch = "chat_translation_enabled" | "sms_enabled" | "email_enabled";

export async function getAdminFeatureSettings(accessToken: string): Promise<AdminFeatureSettings> {
  const res = await fetch(`${API_BASE_URL}/api/admin/feature-settings/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the feature switches");
  return res.json();
}

export async function updateAdminFeatureSettings(changes: Partial<Record<AdminFeatureSwitch, boolean>>, accessToken: string): Promise<AdminFeatureSettings> {
  const res = await fetch(`${API_BASE_URL}/api/admin/feature-settings/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(changes),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not save the change");
  return data;
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

export const PARTNER_SERVICE_REQUESTED_EVENT = "oaziland:partner-service-requested";

export async function listServiceCategories(): Promise<PaginatedResponse<ServiceCategory>> {
  // The API pages categories 20 at a time; follow every page so none are silently dropped.
  const results: ServiceCategory[] = [];
  let count = 0;
  for (let page = 1; ; page++) {
    const res = await fetch(`${API_BASE_URL}/api/service-categories/?page=${page}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Service catalogue fetch failed: ${res.status}`);
    const data: PaginatedResponse<ServiceCategory> = await res.json();
    results.push(...data.results);
    count = data.count;
    if (!data.next || data.results.length === 0) break;
  }
  return { count, next: null, previous: null, results };
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

export type AgentSpecialty = "RENTALS" | "SALES" | "LAND" | "COMMERCIAL" | "STUDENT_HOUSING" | "SHORT_STAY" | "PROPERTY_MANAGEMENT";
export type AgentLanguage = "EN" | "FR" | "PIDGIN" | "FULFULDE" | "EWONDO" | "DUALA" | "OTHER";
export const AGENT_SPECIALTIES: AgentSpecialty[] = ["RENTALS", "SALES", "LAND", "COMMERCIAL", "STUDENT_HOUSING", "SHORT_STAY", "PROPERTY_MANAGEMENT"];
export const AGENT_LANGUAGES: AgentLanguage[] = ["EN", "FR", "PIDGIN", "FULFULDE", "EWONDO", "DUALA", "OTHER"];

export interface AgentListingCard {
  id: string;
  listing_type: string;
  price_xaf: string;
  property_type: string;
  quarter_name: string;
  photo_url: string;
  path: string;
}

export interface AgentProfileDetails {
  bio: string;
  years_experience: number | null;
  specialties: AgentSpecialty[];
  languages: AgentLanguage[];
  areas_served: { id: string; name: string }[];
  intro_video_url: string;
  intro_video_seconds: number | null;
}

export interface AgentDirectoryEntry {
  user_id: string;
  full_name: string;
  profile_image_url: string;
  is_kyc_verified: boolean;
  average_rating: number | null;
  rating_count: number;
  active_listing_count: number;
  agency_name: string | null;
  listing_preview: AgentListingCard[];
  has_intro_video: boolean;
  bio: string;
  years_experience: number | null;
  specialties: AgentSpecialty[];
  languages: AgentLanguage[];
  areas_served: { id: string; name: string }[];
}

export interface AgentDirectoryFilters {
  q?: string;
  quarter?: string;
  specialty?: string;
  language?: string;
  verified?: boolean;
  page?: number;
}

export async function listAgents(filters: AgentDirectoryFilters = {}): Promise<{ count: number; page: number; has_more: boolean; results: AgentDirectoryEntry[] }> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.quarter) params.set("quarter", filters.quarter);
  if (filters.specialty) params.set("specialty", filters.specialty);
  if (filters.language) params.set("language", filters.language);
  if (filters.verified) params.set("verified", "1");
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const res = await fetch(`${API_BASE_URL}/api/agents/${params.size ? `?${params}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Agent directory fetch failed: ${res.status}`);
  return res.json();
}

export async function listAgentListings(userId: string, offset = 0, limit = 12): Promise<{ count: number; results: AgentListingCard[]; next_offset: number | null }> {
  const res = await fetch(`${API_BASE_URL}/api/agents/${userId}/listings/?offset=${offset}&limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Agent listings fetch failed: ${res.status}`);
  return res.json();
}

export async function getMyAgentProfile(accessToken: string): Promise<AgentProfileDetails> {
  const res = await fetch(`${API_BASE_URL}/api/my-agent-profile/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiStatusError(data.detail || "Could not load your agent profile", res.status);
  return data;
}

export async function updateMyAgentProfile(
  changes: Partial<Omit<AgentProfileDetails, "areas_served">> & { areas_served?: string[] },
  accessToken: string,
): Promise<AgentProfileDetails> {
  const res = await fetch(`${API_BASE_URL}/api/my-agent-profile/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(changes),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not save your profile");
  return data;
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
  id: number;
  author_id: string;
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
export interface PolicyDocument {
  document_type: "TERMS_OF_SERVICE" | "PRIVACY_POLICY" | "COMMUNITY_GUIDELINES";
  version: string;
  body_text: string;
}

/** The current published text of a policy, or null when none has been published yet. */
export async function getCurrentPolicy(documentType: PolicyDocument["document_type"]): Promise<PolicyDocument | null> {
  const res = await fetch(`${API_BASE_URL}/api/policy-documents/`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Policy fetch failed: ${res.status}`);
  const data = await res.json();
  const rows: PolicyDocument[] = Array.isArray(data) ? data : data.results ?? [];
  return rows.find((d) => d.document_type === documentType) ?? null;
}

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
  provider_id: string;
  price_xaf: string | null;
  issues_certification: boolean;
  /** e.g. "7.5"; null when the course doesn't state its length. */
  duration_hours: string | null;
  /** How long certificates stay valid; null = they never expire. */
  certificate_validity_months: number | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string;
  lesson_count: number;
  /** Uploaded by an admin or the course's lecturer; empty when the card should use its category colours. */
  cover_image_url: string;
  /** Average learner rating (1-5, one decimal), or null before anyone has reviewed the course. */
  rating_average: number | null;
  rating_count: number;
  learner_count: number;
}

export type CourseSyllabusLesson = { id: string; title: string; kind: LessonKind; is_preview: boolean };
/** The public course page: the card's details plus the syllabus (titles only, never lesson content). */
export interface TrainingProgramDetail extends TrainingProgram {
  syllabus: { id: string; title: string; due_after_days: number | null; lessons: CourseSyllabusLesson[] }[];
}

export async function getTraining(id: string): Promise<TrainingProgramDetail | null> {
  const res = await fetch(`${API_BASE_URL}/api/trainings/${encodeURIComponent(id)}/`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Training fetch failed: ${res.status}`);
  return res.json();
}

export interface CourseReviewItem {
  id: string;
  score: number;
  text: string;
  author_name: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
  is_mine: boolean;
}
export interface CourseReviews {
  average: number | null;
  count: number;
  distribution: Record<"5" | "4" | "3" | "2" | "1", number>;
  results: CourseReviewItem[];
  my_review: CourseReviewItem | null;
  can_review: boolean;
  cannot_review_reason: "" | "sign_in" | "own_course" | "not_enrolled" | "not_started";
}

async function courseReviewsRequest(id: string, token: string | null, init: RequestInit = {}): Promise<CourseReviews> {
  const res = await fetch(`${API_BASE_URL}/api/trainings/${id}/reviews/`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not load the reviews.");
  return data;
}
export const getCourseReviews = (id: string, token: string | null) => courseReviewsRequest(id, token);
export const saveCourseReview = (id: string, score: number, text: string, token: string) =>
  courseReviewsRequest(id, token, { method: "POST", body: JSON.stringify({ score, text }) });
export const deleteCourseReview = (id: string, token: string) => courseReviewsRequest(id, token, { method: "DELETE" });

export interface DiscussionPost {
  id: string;
  title: string;
  body: string;
  author_name: string;
  author_is_staff: boolean;
  lesson: { id: string; title: string } | null;
  created_at: string;
  edited_at: string | null;
  is_mine: boolean;
  can_edit: boolean;
  can_delete: boolean;
}
export interface DiscussionThreadSummary extends DiscussionPost {
  reply_count: number;
  last_activity_at: string;
  answered_by_staff: boolean;
}
export interface DiscussionThread extends DiscussionPost {
  last_activity_at: string;
  replies: DiscussionPost[];
}

async function discussionRequest<T>(programId: string, path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithAutoRefresh(
    `${API_BASE_URL}/api/trainings/${programId}/discussions/${path}`,
    { ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } },
    token,
  );
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Something went wrong. Please try again.");
  return data as T;
}
export const listDiscussions = (programId: string, token: string, filters: { lesson?: string; q?: string } = {}) => {
  const params = new URLSearchParams();
  if (filters.lesson) params.set("lesson", filters.lesson);
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  const query = params.toString();
  return discussionRequest<{ results: DiscussionThreadSummary[]; is_staff: boolean }>(programId, query ? `?${query}` : "", token);
};
export const getDiscussion = (programId: string, threadId: string, token: string) =>
  discussionRequest<DiscussionThread>(programId, `${threadId}/`, token);
export const startDiscussion = (programId: string, input: { title: string; body: string; lesson?: string }, token: string) =>
  discussionRequest<DiscussionThread>(programId, "", token, { method: "POST", body: JSON.stringify(input) });
export const replyToDiscussion = (programId: string, threadId: string, body: string, token: string) =>
  discussionRequest<DiscussionThread>(programId, `${threadId}/`, token, { method: "POST", body: JSON.stringify({ body }) });
export const editDiscussionPost = (programId: string, postId: string, input: { body: string; title?: string }, token: string) =>
  discussionRequest<DiscussionThread>(programId, `${postId}/`, token, { method: "PATCH", body: JSON.stringify(input) });
export const deleteDiscussionPost = (programId: string, postId: string, token: string) =>
  discussionRequest<DiscussionThread | undefined>(programId, `${postId}/`, token, { method: "DELETE" });

export interface CourseCertificate {
  code: string;
  learner_name: string;
  course_id: string;
  course_title: string;
  category: string;
  provider_name: string;
  issued_at: string;
  completed_at: string;
  /** null = never expires */
  expires_at: string | null;
  is_expired: boolean;
  hours: number | null;
  /** Average of the learner's best quiz scores; null for a course without quizzes. */
  grade_percent: number | null;
  lesson_count: number;
  orientation: CertificateOrientation;
}
/** The certificate exactly as the system draws it (from the admin's active template), for the verification page. */
export const certificateImageUrl = (code: string, locale: string) =>
  `${API_BASE_URL}/api/certificates/${encodeURIComponent(code)}/image/?lang=${locale === "fr" ? "fr" : "en"}`;

// ---- Admin certificate designer (/api/admin/certificate-templates/). Positions are in design units: the page is
// 1000 units wide and 707 (landscape) or 1414 (portrait) tall.
export type CertificateOrientation = "LANDSCAPE" | "PORTRAIT";
interface CertificateElementBase { id: string; x: number; y: number; w: number }
export interface CertificateTextElement extends CertificateElementBase {
  type: "text";
  text: string;
  text_fr: string;
  font: "sans" | "serif";
  bold: boolean;
  size: number;
  color: string;
  align: "left" | "center" | "right";
  single_line: boolean;
}
export interface CertificateLogoElement extends CertificateElementBase { type: "logo" }
export interface CertificateSignatureElement extends CertificateElementBase { type: "signature" }
export interface CertificateQrElement extends CertificateElementBase { type: "qr"; color: string }
export interface CertificateLineElement extends CertificateElementBase { type: "line"; thickness: number; color: string }
export interface CertificateRectElement extends CertificateElementBase { type: "rect"; h: number; thickness: number; color: string }
export type CertificateElement =
  | CertificateTextElement
  | CertificateLogoElement
  | CertificateSignatureElement
  | CertificateQrElement
  | CertificateLineElement
  | CertificateRectElement;
export interface CertificateTemplate {
  id: string;
  name: string;
  orientation: CertificateOrientation;
  background_color: string;
  background_image_url: string;
  logo_url: string;
  signature_url: string;
  layout: CertificateElement[];
  is_active: boolean;
  course_count: number;
  updated_at: string;
}
export interface CourseCertificateChoice {
  template_id: string | null;
  default: CertificateTemplate | null; // null = the built-in design
  builtin: { layout: CertificateElement[]; background_color: string };
  options: CertificateTemplate[];
  can_change: boolean;
}
export const getCourseCertificateTemplate = (programId: string, token: string) =>
  courseRequest<CourseCertificateChoice>(`/manage/courses/${programId}/certificate-template/`, token);
export const setCourseCertificateTemplate = (programId: string, templateId: string | null, token: string) =>
  courseRequest<CourseCertificateChoice>(`/manage/courses/${programId}/certificate-template/`, token, {
    method: "PUT", body: JSON.stringify({ template_id: templateId }),
  });
export interface CertificateTemplateList {
  results: CertificateTemplate[];
  builtin_active: boolean;
  default_layout: CertificateElement[];
  default_background_color: string;
  placeholders: string[];
}
export type CertificateTemplateSettings = Partial<Pick<CertificateTemplate, "name" | "orientation" | "background_color" | "layout">>;
const certTemplatePath = (id = "", action = "") =>
  `/admin/certificate-templates/${id ? `${id}/` : ""}${action ? `${action}/` : ""}`;
export const listCertificateTemplates = (token: string) => courseRequest<CertificateTemplateList>(certTemplatePath(), token);
export const createCertificateTemplate = (name: string, startFrom: "default" | "empty", token: string) =>
  courseRequest<CertificateTemplate>(certTemplatePath(), token, { method: "POST", body: JSON.stringify({ name, start_from: startFrom }) });
export const updateCertificateTemplate = (id: string, settings: CertificateTemplateSettings, token: string) =>
  courseRequest<CertificateTemplate>(certTemplatePath(id), token, { method: "PATCH", body: JSON.stringify(settings) });
export const deleteCertificateTemplate = (id: string, token: string) =>
  courseRequest<void>(certTemplatePath(id), token, { method: "DELETE" });
export const activateCertificateTemplate = (id: string, token: string) =>
  courseRequest<CertificateTemplate>(certTemplatePath(id, "activate"), token, { method: "POST" });
export const duplicateCertificateTemplate = (id: string, token: string) =>
  courseRequest<CertificateTemplate>(certTemplatePath(id, "duplicate"), token, { method: "POST" });
export const switchToBuiltinCertificate = (token: string) =>
  courseRequest<{ builtin_active: boolean }>(certTemplatePath("", "use-builtin"), token, { method: "POST" });
export type CertificateFileKind = "background" | "logo" | "signature";
export const uploadCertificateFile = (id: string, kind: CertificateFileKind, file: File, token: string) => {
  const form = new FormData();
  form.append("file", file);
  return courseRequest<CertificateTemplate>(certTemplatePath(id, kind), token, { method: "POST", body: form });
};
export const removeCertificateFile = (id: string, kind: CertificateFileKind, token: string) =>
  courseRequest<CertificateTemplate>(certTemplatePath(id, kind), token, { method: "DELETE" });
/** The template drawn by the server with sample data — exactly as issued certificates will look. Returns a blob URL. */
export async function previewCertificateTemplate(
  id: string, settings: CertificateTemplateSettings, locale: string, token: string,
): Promise<string> {
  const res = await fetchWithAutoRefresh(
    `${API_BASE_URL}/api${certTemplatePath(id, "preview")}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, locale }) },
    token,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Preview failed (${res.status})`);
  }
  return URL.createObjectURL(await res.blob());
}
/** Direct link to the certificate as a downloadable PDF (public, like the verification page). */
export const certificatePdfUrl = (code: string, locale: string) =>
  `${API_BASE_URL}/api/certificates/${encodeURIComponent(code)}/pdf/?lang=${locale === "fr" ? "fr" : "en"}`;

export interface TrainerPage {
  id: string;
  name: string;
  photo_url: string;
  headline: string;
  bio: string;
  website: string;
  stats: { courses: number; learners: number; rating_average: number | null; rating_count: number };
  courses: TrainingProgram[];
}
export async function getTrainer(id: string): Promise<TrainerPage | null> {
  const res = await fetch(`${API_BASE_URL}/api/trainers/${encodeURIComponent(id)}/`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Trainer fetch failed: ${res.status}`);
  return res.json();
}
export interface MyTrainerProfile { id: string; headline: string; bio: string; website: string; is_trainer: boolean }
export const getMyTrainerProfile = (token: string) => courseRequest<MyTrainerProfile>("/my-trainer-profile/", token);
export const saveMyTrainerProfile = (input: { headline: string; bio: string; website: string }, token: string) =>
  courseRequest<MyTrainerProfile>("/my-trainer-profile/save/", token, { method: "PUT", body: JSON.stringify(input) });

export async function getCertificate(code: string): Promise<CourseCertificate | null> {
  const res = await fetch(`${API_BASE_URL}/api/certificates/${encodeURIComponent(code)}/`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Certificate fetch failed: ${res.status}`);
  return res.json();
}

export interface TrainingFilters {
  category?: string;
  q?: string;
  free?: boolean;
  certificate?: boolean;
  ordering?: TrainingOrdering;
  page?: number;
}

export const TRAINING_ORDERINGS = ["popular", "rating", "price_asc", "price_desc"] as const;
export type TrainingOrdering = (typeof TRAINING_ORDERINGS)[number];

export async function listTrainings(
  filters: TrainingFilters = {},
): Promise<{ count: number; next: string | null; previous: string | null; results: TrainingProgram[] }> {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.q) params.set("q", filters.q);
  if (filters.free) params.set("free", "true");
  if (filters.certificate) params.set("certificate", "true");
  if (filters.ordering) params.set("ordering", filters.ordering);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  const res = await fetch(`${API_BASE_URL}/api/trainings/${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Training fetch failed: ${res.status}`);
  return res.json();
}

/** A paid course also needs the Mobile Money number to charge; the enrollment then waits as PAYMENT_PENDING (202). */
export async function enrollInTraining(programId: string, accessToken: string, phoneNumber?: string) {
  const res = await fetch(`${API_BASE_URL}/api/trainings/${programId}/enroll/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(phoneNumber ? { phone_number: phoneNumber } : {}),
  });
  return res;
}

export interface TrainingEnrollmentItem {
  id: string;
  program: string;
  program_detail?: TrainingProgram;
  status: "PAYMENT_PENDING" | "ENROLLED" | "IN_PROGRESS" | "COMPLETED" | "DROPPED";
  progress?: { total: number; done: number; percent: number };
  /** The course fee's payment: booking status, and escrow_status once paid (HELD until completion, then RELEASED). */
  payment?: { status: string; amount_xaf: string; escrow_status: "HELD" | "RELEASED" | "REFUNDED" | "DISPUTED" | null } | null;
  enrolled_at: string;
  completed_at: string | null;
  certificate_issued_at: string | null;
  /** Printed on the certificate and checkable by anyone at /certificates/<code>. */
  certificate_code: string | null;
  /** The first unfinished lesson (where "Continue" opens), for active enrollments; null when none is left. */
  next_lesson?: { id: string; title: string; kind: LessonKind } | null;
  /** When the learner last finished a lesson, took a quiz or handed in work; null before they start. */
  last_activity_at?: string | null;
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

// ---------------------------------------------------------------------------
// Courses (Coursera-style): learner player + staff authoring/supervision.
// ---------------------------------------------------------------------------
export type LessonKind = "TEXT" | "VIDEO" | "PDF" | "QUIZ" | "ASSIGNMENT";

export type SubmissionStatus = "SUBMITTED" | "APPROVED" | "CHANGES_REQUESTED";

export type QuestionKind = "CHOICE" | "SHORT_TEXT" | "NUMBER";

export interface CourseSubmissionInfo {
  status: SubmissionStatus;
  feedback: string;
  submitted_at: string;
  /** How many classmates have reviewed it so far (peer-reviewed assignments). */
  peer_reviews_received?: number;
}

export interface CourseOutlineQuestion {
  id: string;
  text: string;
  kind: QuestionKind;
  /** Multiple-choice only: more than one choice is right, so the learner ticks several. */
  multiple: boolean;
  /** Empty for short-answer and number questions, which are typed. */
  choices: { id: string; text: string }[];
}

export interface CoursePeerInfo { required: number; given: number; can_review: boolean }

export interface CourseOutlineLesson {
  id: string;
  title: string;
  kind: LessonKind;
  content_text: string;
  video_url: string;
  video_file_url: string;
  pdf_url: string;
  completed: boolean;
  submission?: CourseSubmissionInfo | null;
  /** Assignments only: classmates review each other's work. */
  peer_review?: boolean;
  peer?: CoursePeerInfo;
  pass_mark_percent?: number;
  best_score_percent?: number | null;
  questions?: CourseOutlineQuestion[];
  /** Attempts the learner can still make now (0 once passed or while waiting for retry_at). */
  attempts_left?: number;
  attempts_per_window?: number;
  /** When the next attempt opens, if the learner has used all of theirs. */
  retry_at?: string | null;
  /** The passing attempt with its correct answers and explanations; null until the quiz is passed. */
  review?: QuizReview | null;
}

export interface QuizGradedQuestion {
  question: string;
  correct: boolean;
  correct_choices?: string[];
  /** Short-answer and number questions: what counted as right (revealed once the quiz is passed). */
  correct_answers?: string[];
  /** Number questions: how far off the answer could be and still be right. */
  tolerance?: string;
  explanation?: string;
}
export interface QuizReview { score_percent: number; answers: Record<string, string[]>; results: QuizGradedQuestion[] }

export interface CourseProgress {
  total: number;
  done: number;
  percent: number;
}

export interface CourseOutline {
  program: { id: string; title: string };
  status: TrainingEnrollmentItem["status"];
  certificate_issued_at: string | null;
  certificate_code: string | null;
  progress: CourseProgress;
  /** Median hours this course's assignments waited for review (null until there's enough history). */
  typical_review_hours: number | null;
  /** Modules whose suggested finish date has passed and that aren't finished yet. */
  overdue_modules: number;
  modules: {
    id: string; title: string; lessons: CourseOutlineLesson[];
    /** The suggested pace: finish this module within this many days of enrolling (null = none). */
    due_after_days: number | null; due_at: string | null; overdue: boolean;
  }[];
}

export interface QuizResult {
  score_percent: number;
  passed: boolean;
  pass_mark_percent: number;
  status: TrainingEnrollmentItem["status"];
  progress: CourseProgress;
  /** correct_choices and explanation are only included when the quiz was passed. */
  results: QuizGradedQuestion[];
  attempts_left: number;
  attempts_per_window: number;
  retry_at: string | null;
}

async function courseRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetchWithAutoRefresh(
    `${API_BASE_URL}/api${path}`,
    { ...init, headers: { ...(isForm || !init.body ? {} : { "Content-Type": "application/json" }), ...init.headers } },
    token,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail ?? (body && typeof body === "object" ? Object.values(body).flat().join(" ") : "");
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const getCourseOutline = (enrollmentId: string, token: string) =>
  courseRequest<CourseOutline>(`/my-enrollments/${enrollmentId}/course/`, token);
export const completeCourseLesson = (enrollmentId: string, lessonId: string, token: string) =>
  courseRequest<{ status: string; progress: CourseProgress }>(`/my-enrollments/${enrollmentId}/lessons/${lessonId}/complete/`, token, { method: "POST" });
export const submitCourseQuiz = (enrollmentId: string, lessonId: string, answers: Record<string, string[]>, token: string) =>
  courseRequest<QuizResult>(`/my-enrollments/${enrollmentId}/quizzes/${lessonId}/submit/`, token, { method: "POST", body: JSON.stringify({ answers }) });

export const submitCourseAssignment = (enrollmentId: string, lessonId: string, file: File, token: string) => {
  const form = new FormData();
  form.append("file", file);
  return courseRequest<{ status: SubmissionStatus }>(`/my-enrollments/${enrollmentId}/assignments/${lessonId}/submit/`, token, { method: "POST", body: form });
};

// Submissions are private: the PDF is fetched with the user's token and shown from a temporary blob URL.
// The tab is opened synchronously (inside the click) so popup blockers allow it, then pointed at the blob.
export async function openPrivatePdf(path: string, token: string): Promise<void> {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const res = await fetchWithAutoRefresh(`${API_BASE_URL}/api${path}`, {}, token);
    if (!res.ok) throw new Error(`Could not open the file (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
export const openMySubmission = (enrollmentId: string, lessonId: string, token: string) =>
  openPrivatePdf(`/my-enrollments/${enrollmentId}/assignments/${lessonId}/file/`, token);

export interface PeerQueueItem { id: string; submitted_at: string; reviews: number }
export const getPeerReviewQueue = (enrollmentId: string, lessonId: string, token: string) =>
  courseRequest<{ required: number; items: PeerQueueItem[] }>(`/my-enrollments/${enrollmentId}/assignments/${lessonId}/peer/`, token);
export const openPeerSubmission = (enrollmentId: string, submissionId: string, token: string) =>
  openPrivatePdf(`/my-enrollments/${enrollmentId}/peer/${submissionId}/file/`, token);
export const submitPeerReview = (enrollmentId: string, submissionId: string, decision: "APPROVED" | "CHANGES_REQUESTED", feedback: string, token: string) =>
  courseRequest<{ reviewed: boolean }>(`/my-enrollments/${enrollmentId}/peer/${submissionId}/review/`, token, { method: "POST", body: JSON.stringify({ decision, feedback }) });

/** A lesson anyone can open without enrolling or paying. */
export interface CoursePreviewLesson {
  id: string;
  title: string;
  kind: LessonKind;
  module_title: string;
  content_text: string;
  video_url: string;
  video_file_url: string;
  pdf_url: string;
}
export async function getCoursePreview(courseId: string): Promise<CoursePreviewLesson[]> {
  const res = await fetch(`${API_BASE_URL}/api/trainings/${courseId}/preview/`);
  if (!res.ok) throw new Error(`Could not load the preview (${res.status})`);
  return res.json();
}

export interface CourseSubmissionRow {
  id: string;
  lesson: string;
  lesson_title: string;
  student_name: string;
  username: string;
  status: SubmissionStatus;
  feedback: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  /** The assignment is reviewed by classmates; their anonymous verdicts are listed for staff. */
  peer_review: boolean;
  peer_reviews: { decision: SubmissionStatus; feedback: string }[];
}
export const listCourseSubmissions = (courseId: string, token: string) =>
  courseRequest<CourseSubmissionRow[]>(`/manage/courses/${courseId}/submissions/`, token);
export const openCourseSubmission = (courseId: string, submissionId: string, token: string) =>
  openPrivatePdf(`/manage/courses/${courseId}/submissions/${submissionId}/file/`, token);
export const reviewCourseSubmission = (courseId: string, submissionId: string, decision: "APPROVED" | "CHANGES_REQUESTED", feedback: string, token: string) =>
  courseRequest<{ status: SubmissionStatus }>(`/manage/courses/${courseId}/submissions/${submissionId}/review/`, token, { method: "POST", body: JSON.stringify({ decision, feedback }) });

export interface ManageChoice { id?: string; text: string; is_correct: boolean }
export interface ManageQuestion {
  id: string; lesson: string; text: string; explanation: string; position: number; choices: ManageChoice[];
  kind: QuestionKind; accepted_answers: string[]; tolerance: string;
}
export interface ManageLesson {
  id: string;
  module: string;
  title: string;
  kind: LessonKind;
  position: number;
  content_text: string;
  video_url: string;
  video_file_url: string;
  pdf_url: string;
  pass_mark_percent: number;
  /** Readings, videos and PDFs only: open to everyone as a free preview. */
  is_preview: boolean;
  /** Assignments only: classmates review each other's work. */
  peer_review: boolean;
  questions: ManageQuestion[];
}
export interface ManageModule { id: string; program: string; title: string; position: number; due_after_days: number | null; lessons: ManageLesson[] }
export interface ManageCourse {
  id: string;
  title: string;
  description: string;
  category: string;
  price_xaf: string | null;
  issues_certification: boolean;
  duration_hours: string | null;
  certificate_validity_months: number | null;
  is_published: boolean;
  cover_image_url: string;
  modules: ManageModule[];
  my_role: "ADMIN" | "OWNER" | "LECTURER" | "SUPERVISOR" | null;
  learner_count: number;
  provider_name: string;
  review_requested_at: string | null;
  /** Whether this user may put the course live (trainers without publishing rights submit it for review). */
  can_publish: boolean;
}
/** What the signed-in user may do in course management (course-creator access is granted by admins). */
export interface CourseAccess { is_admin: boolean; can_create: boolean; can_publish: boolean; has_courses: boolean }
export const getCourseAccess = (token: string) => courseRequest<CourseAccess>("/manage/courses/access/", token);
export const requestCourseReview = (id: string, token: string) =>
  courseRequest<ManageCourse>(`/manage/courses/${id}/request-review/`, token, { method: "POST" });

export interface CourseCreatorPerson { id: string; name: string; username: string; phone: string; email: string }
export interface CourseCreatorGrant {
  id: number;
  user: CourseCreatorPerson;
  can_publish: boolean;
  granted_by: string;
  granted_at: string;
  course_count: number;
  published_count: number;
}
export interface CourseCreatorList {
  results: CourseCreatorGrant[];
  awaiting_review: { id: string; title: string; provider: CourseCreatorPerson; requested_at: string }[];
}
export const listCourseCreators = (token: string) => courseRequest<CourseCreatorList>("/admin/course-creators/", token);
export const grantCourseCreator = (identifier: string, canPublish: boolean, token: string) =>
  courseRequest<CourseCreatorGrant>("/admin/course-creators/", token, {
    method: "POST", body: JSON.stringify({ identifier, can_publish: canPublish }),
  });
export const updateCourseCreator = (id: number, canPublish: boolean, token: string) =>
  courseRequest<CourseCreatorGrant>(`/admin/course-creators/${id}/`, token, { method: "PATCH", body: JSON.stringify({ can_publish: canPublish }) });
export const revokeCourseCreator = (id: number, token: string) =>
  courseRequest<void>(`/admin/course-creators/${id}/`, token, { method: "DELETE" });
export interface CourseStaffMember { id: number; user: string; user_name: string; username: string; phone: string; role: "LECTURER" | "SUPERVISOR" }
export interface CourseLearnerRow {
  enrollment: string;
  student_name: string;
  username: string;
  phone: string;
  status: TrainingEnrollmentItem["status"];
  enrolled_at: string;
  completed_at: string | null;
  certificate_issued_at: string | null;
  lessons_done: number;
  lessons_total: number;
  progress_percent: number;
  quizzes: { lesson: string; lesson_title: string; attempts: number; best_score_percent: number; latest_score_percent: number; passed: boolean }[];
}

export const listManagedCourses = (token: string) =>
  courseRequest<{ count: number; results: ManageCourse[] }>("/manage/courses/", token);
export const getManagedCourse = (id: string, token: string) => courseRequest<ManageCourse>(`/manage/courses/${id}/`, token);
export const createManagedCourse = (payload: Partial<ManageCourse>, token: string) =>
  courseRequest<ManageCourse>("/manage/courses/", token, { method: "POST", body: JSON.stringify(payload) });
export const updateManagedCourse = (id: string, payload: Partial<ManageCourse>, token: string) =>
  courseRequest<ManageCourse>(`/manage/courses/${id}/`, token, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteManagedCourse = (id: string, token: string) =>
  courseRequest<void>(`/manage/courses/${id}/`, token, { method: "DELETE" });
/** Uploads a new cover image, or removes the current one when `file` is null. */
export const setManagedCourseCover = (id: string, file: File | null, token: string) => {
  if (!file) {
    return courseRequest<ManageCourse>(`/manage/courses/${id}/`, token, { method: "PATCH", body: JSON.stringify({ remove_cover_image: true }) });
  }
  const form = new FormData();
  form.append("cover_image", file);
  return courseRequest<ManageCourse>(`/manage/courses/${id}/`, token, { method: "PATCH", body: form });
};

export const listCourseStaff = (id: string, token: string) => courseRequest<CourseStaffMember[]>(`/manage/courses/${id}/staff/`, token);
export const assignCourseStaff = (id: string, identifier: string, role: "LECTURER" | "SUPERVISOR", token: string) =>
  courseRequest<CourseStaffMember>(`/manage/courses/${id}/staff/`, token, { method: "POST", body: JSON.stringify({ identifier, role }) });
export const removeCourseStaff = (id: string, staffId: number, token: string) =>
  courseRequest<void>(`/manage/courses/${id}/staff/${staffId}/`, token, { method: "DELETE" });
export interface CourseAnalytics {
  learners: { total: number; awaiting_payment: number; enrolled: number; in_progress: number; completed: number; dropped: number; completion_percent: number; certificates: number };
  lesson_funnel: { position: number; lesson_id: string; title: string; kind: LessonKind; completed: number; percent: number; drop_off_percent: number }[];
  quizzes: { lesson_id: string; title: string; pass_mark_percent: number; learners: number; attempts: number; average_best_score: number | null; average_attempts: number | null; first_try_pass_percent: number; pass_percent: number }[];
  rating: { average: number | null; count: number };
  /** Only for admins and the course's provider. */
  earnings: { sales: number; paid_by_learners_xaf: string; held_in_escrow_xaf: string; released_to_trainer_xaf: string; platform_fees_xaf: string; refunded_xaf: string } | null;
}
export const getCourseAnalytics = (id: string, token: string) => courseRequest<CourseAnalytics>(`/manage/courses/${id}/analytics/`, token);
export const listCourseLearners = (id: string, token: string) => courseRequest<CourseLearnerRow[]>(`/manage/courses/${id}/learners/`, token);
export const completeCourseLearner = (id: string, enrollmentId: string, token: string) =>
  courseRequest<{ status: string; completed_at: string; certificate_issued_at: string | null }>(
    `/manage/courses/${id}/learners/${enrollmentId}/complete/`, token, { method: "POST" },
  );

export const createCourseModule = (program: string, title: string, token: string) =>
  courseRequest<ManageModule>("/manage/modules/", token, { method: "POST", body: JSON.stringify({ program, title }) });
export const updateCourseModule = (id: string, payload: Partial<ManageModule>, token: string) =>
  courseRequest<ManageModule>(`/manage/modules/${id}/`, token, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteCourseModule = (id: string, token: string) => courseRequest<void>(`/manage/modules/${id}/`, token, { method: "DELETE" });

export type LessonInput = Partial<Omit<ManageLesson, "questions" | "pdf_url" | "video_file_url">> & {
  pdf_file?: File | null;
  remove_pdf?: boolean;
  video_file?: File | null;
  remove_video_file?: boolean;
};
function lessonBody(input: LessonInput): FormData {
  const form = new FormData();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, value instanceof File ? value : String(value));
  });
  return form;
}
export const createCourseLesson = (input: LessonInput, token: string) =>
  courseRequest<ManageLesson>("/manage/lessons/", token, { method: "POST", body: lessonBody(input) });
export const updateCourseLesson = (id: string, input: LessonInput, token: string) =>
  courseRequest<ManageLesson>(`/manage/lessons/${id}/`, token, { method: "PATCH", body: lessonBody(input) });
export const deleteCourseLesson = (id: string, token: string) => courseRequest<void>(`/manage/lessons/${id}/`, token, { method: "DELETE" });

export type QuestionInput = {
  lesson?: string; text: string; explanation: string; kind: QuestionKind;
  choices?: ManageChoice[]; accepted_answers?: string[]; tolerance?: string;
};
export const createCourseQuestion = (input: QuestionInput, token: string) =>
  courseRequest<ManageQuestion>("/manage/questions/", token, { method: "POST", body: JSON.stringify(input) });
export const updateCourseQuestion = (id: string, input: QuestionInput, token: string) =>
  courseRequest<ManageQuestion>(`/manage/questions/${id}/`, token, { method: "PATCH", body: JSON.stringify(input) });
export const deleteCourseQuestion = (id: string, token: string) => courseRequest<void>(`/manage/questions/${id}/`, token, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Job posting management (poster side) & WhatsApp share.
// ---------------------------------------------------------------------------
export interface JobApplicationCertificate {
  code: string;
  title: string;
}

export interface JobApplicationItem {
  id: string;
  job_posting: string;
  job_title: string;
  company_name?: string;
  applicant: string;
  applicant_name: string;
  applicant_phone?: string;
  cover_message: string;
  years_experience?: number | null;
  has_cv?: boolean;
  cv_filename?: string;
  certificates?: JobApplicationCertificate[];
  status: string;
  applied_at: string;
}

export async function listJobApplications(jobId: string, accessToken: string): Promise<JobApplicationItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/applications/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch applications");
  return res.json();
}

/** The signed-in user's own applications, newest first. */
export async function listMyJobApplications(accessToken: string): Promise<JobApplicationItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/my-job-applications/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch your applications");
  const data = await res.json();
  return data.results ?? data;
}

/** The signed-in user's own postings, closed ones included. */
export async function listMyJobPostings(accessToken: string): Promise<JobPosting[]> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/?mine=1`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch your job postings");
  const data = await res.json();
  return data.results ?? data;
}

export interface JobPostingInput {
  company_name?: string;
  title: string;
  role_category: string;
  employment_type?: string;
  workplace_type?: string;
  quarter?: string | null;
  description: string;
  salary_min_xaf?: string | null;
  salary_max_xaf?: string | null;
  closes_at?: string | null;
}

/** Field errors from the server ({ field: ["message"] }) are joined into one readable message. */
function jobErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    const first = Object.values(record).flat().find((v) => typeof v === "string");
    if (typeof first === "string") return first;
  }
  return fallback;
}

export async function createJobPosting(input: JobPostingInput, accessToken: string): Promise<JobPosting> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(jobErrorMessage(data, "Could not post this job")), { status: res.status });
  return data;
}

export async function updateJobPosting(
  jobId: string,
  input: Partial<JobPostingInput>,
  accessToken: string,
): Promise<JobPosting> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(jobErrorMessage(data, "Could not update this job")), { status: res.status });
  return data;
}

export async function closeJobPosting(jobId: string, accessToken: string): Promise<JobPosting> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/close/`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(jobErrorMessage(data, "Could not close this job"));
  return data;
}

export async function reopenJobPosting(jobId: string, accessToken: string): Promise<JobPosting> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/reopen/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(jobErrorMessage(data, "Could not reopen this job"));
  return data;
}

/** Downloads an applicant's private PDF CV (authorized for the job poster or the applicant). */
export async function downloadApplicationCv(
  opts: { jobId: string; applicationId: string } | { myApplicationId: string },
  accessToken: string,
  fallbackFilename = "cv.pdf",
): Promise<void> {
  const url =
    "myApplicationId" in opts
      ? `${API_BASE_URL}/api/my-job-applications/${opts.myApplicationId}/cv/`
      : `${API_BASE_URL}/api/jobs/${opts.jobId}/applications/${opts.applicationId}/cv/`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(jobErrorMessage(data, "Could not download CV"));
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

export async function withdrawMyJobApplication(applicationId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/my-job-applications/${applicationId}/withdraw/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(jobErrorMessage(data, "Could not withdraw application"));
  }
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
  if (!res.ok) throw Object.assign(new Error(`Agency dashboard fetch failed: ${res.status}`), { status: res.status });
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
  /** The marketplace listing this message is about, shown as a card; null when none (or it was removed). */
  listing?: ChatListingCard | null;
}

export interface ChatListingCard {
  id: string;
  category: MarketplaceCategory;
  title: string;
  price_xaf: string;
  price_basis: string;
  availability_status: string;
  quarter_name: string | null;
  photo_url: string | null;
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

export async function sendConversationMessage(conversationId: string, text: string, accessToken: string, listingId?: string): Promise<ConversationMessage> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/send/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text, client_message_id: `web-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...(listingId ? { listing_id: listingId } : {}) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || data.listing_id || "Could not send message");
  }
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
  pending_withdrawals?: number;
  /** Chats handed to a person that no admin has answered yet. */
  support_tickets_awaiting?: number;
  /** Contact-form messages nobody has marked as handled. */
  open_contact_messages?: number;
  ai_flags_pending?: number;
  pending_area_suggestions?: number;
  courses_awaiting_review?: number;
  stuck_payments?: number;
  scheduled_account_deletions?: number;
  /** False for limited admins, who cannot grant the admin role or read the audit log. */
  is_super_admin?: boolean;
  flagged_users_count?: number;
  reports_trend: { current_period_value: number; previous_period_value: number; percent_change: number | null };
  platform_analytics?: AdminPlatformAnalytics;
}

export type AdminVerificationState = "pending" | "approved" | "rejected" | "all";

export type AdminVerificationFlag =
  | "subject_missing"
  | "not_owner"
  | "no_document"
  | "insecure_document"
  | "id_not_verified"
  | "has_strikes"
  | "account_restricted"
  | "previously_rejected"
  | "role_missing"
  | "waiting_long";

export interface AdminVerificationRequest {
  id: string;
  request_type: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string;
  rejection_reason: string;
  document: { url: string; host: string } | null;
  requester: {
    id: string;
    name: string;
    username: string;
    phone: string;
    email: string;
    kyc_status: string;
    strikes: number;
    account_status: string;
    joined_at: string;
    requests_total: number;
    requests_approved: number;
    requests_rejected: number;
  };
  /** What is being verified; `found` is false when it no longer exists. */
  subject: {
    kind: string;
    title: string;
    excerpt: string;
    owner: { id: string; name: string; username: string } | null;
    path: string;
    found: boolean;
    /** Role details: an agency's registration number and agent count, an agent's agency, a landlord's properties. */
    facts: Record<string, string | number>;
  };
  flags: AdminVerificationFlag[];
}

export interface AdminCaterer {
  id: string;
  name: string;
  cuisine_type: string;
  verified: boolean;
  price_per_head_min_xaf: string;
  price_per_head_max_xaf: string;
  rating: number | null;
  review_count: number;
}

export async function listAdminCaterers(
  filters: { state: "pending" | "verified" | "all"; q?: string; page?: number },
  accessToken: string
): Promise<{ count: number; next: string | null; results: AdminCaterer[] }> {
  const params = new URLSearchParams({ state: filters.state });
  if (filters.q) params.set("q", filters.q);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const res = await fetch(`${API_BASE_URL}/api/admin/caterers/?${params.toString()}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Caterers fetch failed: ${res.status}`);
  return res.json();
}

export async function setAdminCatererVerified(id: string, verified: boolean, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/caterers/${id}/${verified ? "verify" : "unverify"}/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export interface AdminKycReviewItem {
  id: number;
  username: string;
  /** The account's own name (may be blank); compare with legal_full_name. */
  full_name: string;
  phone: string;
  email: string;
  date_joined: string;
  legal_full_name: string;
  date_of_birth: string;
  age: number | null;
  national_id_number: string;
  /** How many other submissions use the same ID number. */
  duplicate_id_count: number;
  /** null when the account has no name to compare against. */
  name_matches_account: boolean | null;
  id_document_front_image_url: string;
  id_document_back_image_url: string;
  selfie_image_url: string;
  residential_address: string;
  kyc_status: string;
  submitted_at: string;
  reviewed_at: string | null;
}

export type AdminReportTargetType =
  | "post" | "video" | "comment" | "user" | "marketplace_listing" | "property_listing" | "listing_deleted" | "unknown"
  | Exclude<ReportKind, "listing" | "comment"> | "deleted";

/** What a report is about, in plain terms, as described by the admin API. */
export interface AdminReportTarget {
  type: AdminReportTargetType;
  title: string;
  excerpt: string;
  author_id: string | null;
  author_name: string;
  /** A site path (e.g. /videos/<id>) to open the reported item, or "" when it has no page of its own. */
  path: string;
  /** False when the item is already hidden or removed. */
  available: boolean;
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
  target_user: string | null;
  target: AdminReportTarget;
  notes: string;
  created_at: string;
}

export interface AdminDisputePayment {
  booking_type: string;
  title: string;
  /** "deposit" or "balance" when the payment is only part of a larger purchase. */
  note: string;
  payer: { id: string; name: string; username: string } | null;
  payee: { id: string; name: string; username: string } | null;
  gross_xaf: string;
  fee_xaf: string;
  payee_xaf: string;
  /** What a dispute decision gave back to the payer (all of it for a refund, part of it for a split). */
  refunded_xaf: string;
  escrow_status: string;
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
  payment?: AdminDisputePayment;
}

function adminHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

/** A failed request that keeps its HTTP status (0 = no response), so callers can tell
 * "not allowed" (403) apart from "slow down" (429) or "server/network trouble". */
export class ApiStatusError extends Error {
  constructor(message: string, public status: number, public retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ApiStatusError";
  }
}

/** A one-time link (valid 60 seconds) that signs a full-access admin in to the data admin (/admin/). */
export async function getDataAdminLink(accessToken: string, next?: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/admin/data-admin-ticket/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(next ? { next } : {}),
    });
  } catch {
    throw new ApiStatusError("Data admin link failed: no response", 0);
  }
  if (!res.ok) throw new ApiStatusError(`Data admin link failed: ${res.status}`, res.status);
  return (await res.json()).url;
}

export async function getAdminConsoleSummary(accessToken: string): Promise<AdminConsoleSummary> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/admin/console-summary/`, { headers: adminHeaders(accessToken) });
  } catch {
    throw new ApiStatusError("Admin summary fetch failed: no response", 0);
  }
  if (!res.ok) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    throw new ApiStatusError(
      `Admin summary fetch failed: ${res.status}`,
      res.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : null,
    );
  }
  return res.json();
}

export async function listAdminVerificationRequests(
  filters: { state?: AdminVerificationState; type?: string; q?: string; page?: number },
  accessToken: string
): Promise<{ count: number; next: string | null; results: AdminVerificationRequest[] }> {
  const params = new URLSearchParams();
  if (filters.state && filters.state !== "pending") params.set("state", filters.state);
  if (filters.type) params.set("type", filters.type);
  if (filters.q) params.set("q", filters.q);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/admin/verification-requests/${query}`, { headers: adminHeaders(accessToken), cache: "no-store" });
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

export type DisputeOutcome = "RELEASE" | "REFUND" | "SPLIT";

/** SPLIT needs payerAmountXaf: the whole francs that go back to the payer; the payee gets the rest. */
export async function resolveDispute(id: string, outcome: DisputeOutcome, notes: string, accessToken: string, payerAmountXaf?: number) {
  return fetch(`${API_BASE_URL}/api/admin/dispute-cases/${id}/resolve/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ outcome, notes, ...(outcome === "SPLIT" ? { payer_amount_xaf: payerAmountXaf } : {}) }),
  });
}

export interface AdminWithdrawal {
  id: string;
  user: { id: string; username: string; name: string; phone: string; account_status: string };
  amount_xaf: string;
  fee_xaf: string;
  net_amount_xaf: string;
  status: "PENDING" | "APPROVED" | "PAID_OUT" | "REJECTED";
  requested_at: string;
  resolved_at: string | null;
  phone_number: string;
  provider: string;
  wallet_balance_xaf: string;
  kyc_status: string;
  paid_out_total_xaf: string;
  reviewed_by_name: string;
  rejection_reason: string;
  payout_reference: string;
}

export async function listAdminWithdrawals(status: string, accessToken: string): Promise<{ count: number; results: AdminWithdrawal[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/withdrawals/?status=${status}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Withdrawals fetch failed: ${res.status}`);
  return res.json();
}

export async function approveWithdrawal(id: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/withdrawals/${id}/approve/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export async function rejectWithdrawal(id: string, reason: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/withdrawals/${id}/reject/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ reason }),
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
  /** True for the admin's own row — used to hide actions an admin may not take on themselves. */
  is_self: boolean;
  /** Only set for administrators; a limited admin may be allowed to manage Oaziland's own offers. */
  admin_access?: "full" | "limited" | null;
  platform_access?: boolean;
}

export async function setAdminUserAccess(
  userId: string,
  level: "full" | "limited",
  platformListings: boolean,
  accessToken: string
): Promise<AdminUser> {
  const res = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/admin-access/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ level, platform_listings: platformListings }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not change admin access");
  return data;
}

export interface AdminPricing {
  fees: { category: string; label: string; fee_percent: string | null }[];
  boosts: { placement: string; placement_label: string; duration_unit: string; unit_label: string; price_xaf: string | null }[];
  max_fee_percent: string;
  max_boost_price_xaf: string;
}

export async function getAdminPricing(accessToken: string): Promise<AdminPricing> {
  const res = await fetch(`${API_BASE_URL}/api/admin/pricing/`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Pricing fetch failed: ${res.status}`);
  return res.json();
}

export async function setAdminFeePercent(category: string, feePercent: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/pricing/fees/${category}/`, {
    method: "PUT", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ fee_percent: feePercent }),
  });
}

/** price null stops offering the option. */
export async function setAdminBoostPrice(placement: string, durationUnit: string, price: string | null, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/pricing/boosts/`, {
    method: "PUT", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ placement, duration_unit: durationUnit, price_xaf: price }),
  });
}

export interface AdminSupportMessage {
  id: number;
  sender_type: "USER" | "AI_AGENT" | "HUMAN_AGENT";
  sender_name: string;
  text: string;
  sent_at: string;
}

export interface AdminSupportTicket {
  id: string;
  subject: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  ai_handled: boolean;
  created_at: string;
  resolved_at: string | null;
  user: { id: string; username: string; name: string; phone: string; email: string };
  message_count: number;
  last_message_at: string | null;
  last_sender: "USER" | "AI_AGENT" | "HUMAN_AGENT" | null;
  last_message_preview: string;
  awaiting_admin: boolean;
  assigned_to_name: string;
  /** Only present on the single-ticket view. */
  messages: AdminSupportMessage[] | null;
}

export type AdminSupportView = "awaiting" | "open" | "resolved";

export async function listAdminSupportTickets(view: AdminSupportView, accessToken: string): Promise<{ count: number; results: AdminSupportTicket[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/support-tickets/?view=${view}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Support tickets fetch failed: ${res.status}`);
  return res.json();
}

export async function getAdminSupportTicket(id: string, accessToken: string): Promise<AdminSupportTicket> {
  const res = await fetch(`${API_BASE_URL}/api/admin/support-tickets/${id}/`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Support ticket fetch failed: ${res.status}`);
  return res.json();
}

export async function replyToAdminSupportTicket(id: string, message: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/support-tickets/${id}/reply/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ message }),
  });
}

export async function setAdminSupportTicketResolved(id: string, resolved: boolean, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/support-tickets/${id}/${resolved ? "resolve" : "reopen"}/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export interface AdminContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  resolved: boolean;
  created_at: string;
}

export async function listAdminContactMessages(resolved: boolean, accessToken: string): Promise<{ count: number; results: AdminContactMessage[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/contact-messages/?resolved=${resolved ? 1 : 0}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Contact messages fetch failed: ${res.status}`);
  return res.json();
}

export async function setAdminContactMessageResolved(id: string, resolved: boolean, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/contact-messages/${id}/${resolved ? "resolve" : "reopen"}/`, { method: "POST", headers: adminHeaders(accessToken) });
}

export interface VisitorBreakdownRow {
  key: string;
  page_views: number;
  visitors: number;
}

export interface AdminVisitorSummary {
  range_days: number;
  totals: {
    page_views: number;
    visitors: number;
    pages_per_visitor: number;
    countries: number;
    mobile_share: number;
    signed_in_share: number;
    location_known_share: number;
  };
  today: { page_views: number; visitors: number };
  online_now: number;
  daily: { date: string; page_views: number; visitors: number }[];
  countries: VisitorBreakdownRow[];
  cities: { city: string; region: string; country_code: string; page_views: number; visitors: number }[];
  devices: VisitorBreakdownRow[];
  browsers: VisitorBreakdownRow[];
  operating_systems: VisitorBreakdownRow[];
  languages: VisitorBreakdownRow[];
  timezones: VisitorBreakdownRow[];
  pages: { path: string; page_views: number; visitors: number }[];
  referrers: VisitorBreakdownRow[];
  recent: {
    created_at: string;
    country_code: string;
    region: string;
    city: string;
    device_type: string;
    os: string;
    browser: string;
    path: string;
    locale: string;
    is_signed_in: boolean;
  }[];
  has_city_data: boolean;
  retention_days: number;
}

export async function getAdminVisitorSummary(days: number, accessToken: string): Promise<AdminVisitorSummary> {
  const res = await fetch(`${API_BASE_URL}/api/admin/visitors/?days=${days}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Visitor statistics fetch failed: ${res.status}`);
  return res.json();
}

export interface AdminAuditEntry {
  id: string;
  actor_username: string;
  /** "<resource>/<verb>", e.g. "admin-user/toggle_suspend". */
  action: string;
  target_type: string;
  target_id: string;
  target_label: string;
  details: Record<string, string | number | boolean | null>;
  status_code: number;
  succeeded: boolean;
  ip_address: string | null;
  created_at: string;
}

export interface AdminAuditFilters {
  q?: string;
  outcome?: "failed" | "success" | "";
  since?: string;
  until?: string;
  page?: number;
}

export async function listAdminAuditLog(
  filters: AdminAuditFilters,
  accessToken: string
): Promise<{ count: number; next: string | null; results: AdminAuditEntry[] }> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.since) params.set("since", filters.since);
  if (filters.until) params.set("until", filters.until);
  if (filters.page) params.set("page", String(filters.page));
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/admin/audit-log/${query}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Audit log fetch failed: ${res.status}`);
  return res.json();
}

export type AdminContentType = "property" | "marketplace" | "post";
export type AdminContentState = "live" | "removed" | "all";

export interface AdminContentItem {
  type: AdminContentType;
  id: string;
  title: string;
  excerpt: string;
  /** Property: RENT/SALE. Marketplace: the category. Post: video, standard, reel... */
  kind: string;
  status: string;
  price_xaf: string | null;
  owner_id: string;
  owner_name: string;
  owner_username: string;
  created_at: string;
  /** Public page to open the item on, empty when it has none. */
  path: string;
  removed: boolean;
  takedown: { reason: string; removed_at: string; removed_by: string } | null;
}

export async function listAdminContent(
  filters: { type: AdminContentType; state: AdminContentState; q?: string; page?: number },
  accessToken: string
): Promise<{ count: number; next: string | null; results: AdminContentItem[] }> {
  const params = new URLSearchParams({ type: filters.type, state: filters.state });
  if (filters.q) params.set("q", filters.q);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const res = await fetch(`${API_BASE_URL}/api/admin/content/?${params.toString()}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Content fetch failed: ${res.status}`);
  return res.json();
}

export async function removeAdminContent(type: AdminContentType, id: string, reason: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/content/remove/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ type, id, reason }),
  });
}

export async function restoreAdminContent(type: AdminContentType, id: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/content/restore/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ type, id }),
  });
}

export type AdminAiFlagState = "pending" | "reviewed";

export interface AdminAiFlag extends AdminContentItem {
  flags: { category: string; confidence: string; action: "FLAG_FOR_REVIEW" | "ESCALATE_ADMIN"; scored_at: string }[];
  escalated: boolean;
  flagged_at: string;
  review: { outcome: "KEPT" | "REMOVED"; reviewed_at: string; reviewed_by: string } | null;
}

export async function listAdminAiFlags(
  state: AdminAiFlagState,
  page: number,
  accessToken: string
): Promise<{ count: number; next: string | null; results: AdminAiFlag[] }> {
  const params = new URLSearchParams({ state });
  if (page > 1) params.set("page", String(page));
  const res = await fetch(`${API_BASE_URL}/api/admin/ai-flags/?${params.toString()}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`AI flags fetch failed: ${res.status}`);
  return res.json();
}

export async function keepAdminAiFlaggedContent(type: AdminContentType, id: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/ai-flags/keep/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ type, id }),
  });
}

export async function removeAdminAiFlaggedContent(type: AdminContentType, id: string, reason: string, issueStrike: boolean, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/ai-flags/remove/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) },
    body: JSON.stringify({ type, id, reason, issue_strike: issueStrike }),
  });
}

export type AdminAreaRequestStatus = "pending" | "approved" | "rejected" | "all";

export interface AdminAnalyticsMetric {
  current: number | string;
  previous: number | string;
  /** Percent change against the previous period; null when there was nothing before. */
  change: number | null;
}

export interface AdminAnalytics {
  days: number;
  start: string;
  end: string;
  headline: Record<
    | "new_users"
    | "kyc_submitted"
    | "kyc_verified"
    | "property_listings_published"
    | "marketplace_listings_created"
    | "paid_bookings"
    | "payment_volume_xaf"
    | "fees_earned_xaf"
    | "refunded_xaf"
    | "disputes_opened"
    | "reports_filed"
    | "support_chats"
    | "payouts_xaf",
    AdminAnalyticsMetric
  >;
  series: { interval: "day" | "week"; points: { date: string; new_users: number; paid_bookings: number; payment_volume_xaf: string }[] };
  funnel: { step: "joined" | "kyc_submitted" | "kyc_verified" | "paid_booking" | "listed_something"; count: number; percent: number | null }[];
  speed: Record<"kyc_review" | "dispute_resolution" | "withdrawal_review", { median_hours: number | null; count: number }>;
  breakdowns: {
    by_service: { booking_type: string; label: string; count: number; volume_xaf: string }[];
    top_neighbourhoods: { name: string; count: number }[];
    new_providers: Record<"agents" | "agencies" | "landlords" | "technicians" | "drivers", number>;
  };
}

export interface HostelPerson {
  id: string;
  name: string;
  username: string;
  phone: string;
}

export interface HostelSummary {
  id: string;
  label: string;
  name: string;
  quarter: string;
  owner: HostelPerson | null;
  rooms: number;
  places: number;
  housed_now: number;
  waiting: number;
}

export interface HostelOwnerRoomType extends Omit<HostelRoomType, "max_periods"> {
  is_active: boolean;
  rooms: string[];
}

export interface HostelPlaceHolder {
  id: string;
  student: HostelPerson | null;
  allocated_at: string;
  allocated_by: string;
}

export interface HostelManagerRow {
  contract: string;
  name: string;
  username: string;
  manager_type: "OWNER_DIRECT" | "STAFF" | "AGENT" | "AGENCY";
  scope: "FULL" | "BOOKINGS_ONLY" | "MAINTENANCE_ONLY" | "BILLING_ONLY";
  since: string;
  can_revoke: boolean;
}

export interface HostelBoard {
  hostel: HostelSummary;
  is_owner: boolean;
  listed_by: HostelPerson | null;
  managers: HostelManagerRow[];
  room_types: HostelOwnerRoomType[];
  institutions: { id: number; name: string }[];
  semesters: { id: number; name: string; institution: string; start_date: string; end_date: string; billing_due_date: string }[];
  semester_id: number | null;
  rooms: {
    id: string;
    room_code: string;
    unit_type: string;
    occupancy_model: "PER_BED" | "PER_UNIT";
    room_type: string | null;
    places: { bed: number | null; allocation: HostelPlaceHolder | null }[];
    has_history: boolean;
  }[];
  waitlist: { id: string; position: number; desired_unit_type: string; joined_at: string; student: HostelPerson | null; already_housed: boolean }[];
}

/** Hostels the caller runs rooms for (all of them for an admin). */
export async function listManagedHostels(q: string, accessToken: string): Promise<{ count: number; results: HostelSummary[] }> {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await fetch(`${API_BASE_URL}/api/hostel-rooms/${params}`, { headers: bearer(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Hostels fetch failed: ${res.status}`);
  return res.json();
}

export async function getHostelBoard(hostelId: string, semesterId: number | null, accessToken: string): Promise<HostelBoard> {
  const params = semesterId ? `?semester=${semesterId}` : "";
  const res = await fetch(`${API_BASE_URL}/api/hostel-rooms/${hostelId}/${params}`, { headers: bearer(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Hostel fetch failed: ${res.status}`);
  return res.json();
}

/** One room-management action; on success the server answers with the refreshed board. */
export async function hostelRoomsAction(hostelId: string, action: string, body: Record<string, unknown>, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/hostel-rooms/${hostelId}/${action}/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...bearer(accessToken) }, body: JSON.stringify(body),
  });
}

export async function getAdminAnalytics(days: number, accessToken: string): Promise<AdminAnalytics> {
  const res = await fetch(`${API_BASE_URL}/api/admin/analytics/?days=${days}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Analytics fetch failed: ${res.status}`);
  return res.json();
}

export interface AdminAccountDeletion {
  id: string;
  status: "REQUESTED" | "CANCELLED" | "COMPLETED" | "RETENTION_PERIOD";
  requested_at: string;
  scheduled_for: string;
  completed_at: string | null;
  reason: string;
  /** Past its scheduled date but still waiting (usually because of a blocker). */
  overdue: boolean;
  cancelled_at: string | null;
  cancelled_by: string;
  cancellation_reason: string;
  blockers: string[];
  user: { id: string; username: string; name: string; phone: string; email: string };
}

export interface AdminDataExport {
  id: string;
  status: "PENDING" | "READY" | "FAILED" | "EXPIRED";
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
  downloaded_at: string | null;
  user: { id: string; username: string; name: string };
}

export async function listAdminAccountDeletions(
  filters: { state: "scheduled" | "blocked" | "completed" | "cancelled" | "all"; q?: string; page?: number },
  accessToken: string
): Promise<{ count: number; next: string | null; results: AdminAccountDeletion[] }> {
  const params = new URLSearchParams({ state: filters.state });
  if (filters.q) params.set("q", filters.q);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const res = await fetch(`${API_BASE_URL}/api/admin/account-deletions/?${params.toString()}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Account deletions fetch failed: ${res.status}`);
  return res.json();
}

export async function completeAdminAccountDeletion(id: string, confirmation: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/account-deletions/${id}/complete/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ confirmation }),
  });
}

export async function cancelAdminAccountDeletion(id: string, reason: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/account-deletions/${id}/cancel/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ reason }),
  });
}

export async function listAdminDataExports(
  filters: { state: "all" | "ready" | "expired" | "failed"; q?: string; page?: number },
  accessToken: string
): Promise<{ count: number; next: string | null; results: AdminDataExport[] }> {
  const params = new URLSearchParams({ state: filters.state });
  if (filters.q) params.set("q", filters.q);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const res = await fetch(`${API_BASE_URL}/api/admin/data-exports/?${params.toString()}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Data exports fetch failed: ${res.status}`);
  return res.json();
}

export type AdminPaymentState = "all" | "held" | "released" | "refunded" | "disputed" | "failed" | "processing";

export interface AdminPaymentPerson {
  id: string;
  name: string;
  username: string;
}

export interface AdminPayment {
  id: string;
  booking_type: string;
  status: string;
  amount_xaf: string;
  currency: string;
  created_at: string;
  updated_at: string;
  requester: AdminPaymentPerson | null;
  title: string;
  payee: AdminPaymentPerson | null;
  note: string;
  /** Payment still processing long after it started. */
  stuck: boolean;
  escrow: {
    status: string;
    gross_xaf: string;
    fee_xaf: string;
    payee_xaf: string;
    refunded_xaf: string;
    provider: string;
    provider_reference: string;
    held_at: string;
    released_at: string | null;
  } | null;
  dispute: { id: string; status: string } | null;
}

export interface AdminPaymentsSummary {
  days: number;
  totals: { held_xaf: string; released_xaf: string; refunded_xaf: string; disputed_xaf: string; fees_xaf: string };
  by_type: {
    booking_type: string;
    label: string;
    count: number;
    gross_xaf: string;
    fees_xaf: string;
    held_xaf: string;
    disputed_xaf: string;
    refunded_xaf: string;
  }[];
  attention: { stuck: number; failed_24h: number };
}

export interface AdminPaymentFilters {
  type?: string;
  state?: AdminPaymentState;
  q?: string;
  since?: string;
  until?: string;
  page?: number;
}

export async function listAdminPayments(
  filters: AdminPaymentFilters,
  accessToken: string
): Promise<{ count: number; next: string | null; results: AdminPayment[] }> {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.state && filters.state !== "all") params.set("state", filters.state);
  if (filters.q) params.set("q", filters.q);
  if (filters.since) params.set("since", filters.since);
  if (filters.until) params.set("until", filters.until);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/admin/payments/${query}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Payments fetch failed: ${res.status}`);
  return res.json();
}

export async function getAdminPaymentsSummary(days: number, accessToken: string): Promise<AdminPaymentsSummary> {
  const res = await fetch(`${API_BASE_URL}/api/admin/payments/summary/?days=${days}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Payments summary fetch failed: ${res.status}`);
  return res.json();
}

export interface AdminReturnRow {
  id: string;
  status: MarketplaceReturnStatus;
  kind: MarketplaceReturnKind;
  reason: MarketplaceReturnReason;
  description: string;
  evidence_urls: string[];
  requested_amount_xaf: string | null;
  seller_note: string;
  created_at: string;
  responded_at: string | null;
  resolved_at: string | null;
  respond_by: string | null;
  buyer_decide_by: string | null;
  age_hours: number;
  order: {
    id: string;
    status: string;
    amount_xaf: string;
    quantity: number;
    listing_id: string;
    listing_title: string;
    category: string;
    delivery_method: string;
    shipment_status: string;
  };
  buyer: { id: string; name: string; username: string };
  seller: { id: string; name: string; username: string };
  dispute_id: string | null;
}

export type AdminReturnState = "waiting" | "rejected" | "escalated" | "accepted" | "closed" | "all";

export interface AdminReturnsSummary {
  waiting: number;
  rejected: number;
  escalated: number;
  accepted: number;
  closed: number;
  waiting_over_48h: number;
  total: number;
}

export async function listAdminMarketplaceReturns(
  filters: { state?: AdminReturnState; q?: string; page?: number },
  accessToken: string
): Promise<{ count: number; next: string | null; previous: string | null; results: AdminReturnRow[] }> {
  const params = new URLSearchParams();
  params.set("state", filters.state ?? "all");
  if (filters.q) params.set("q", filters.q);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const res = await fetch(`${API_BASE_URL}/api/admin/marketplace-returns/?${params.toString()}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Returns fetch failed: ${res.status}`);
  return res.json();
}

export async function getAdminMarketplaceReturnsSummary(accessToken: string): Promise<AdminReturnsSummary> {
  const res = await fetch(`${API_BASE_URL}/api/admin/marketplace-returns/summary/`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Returns summary fetch failed: ${res.status}`);
  return res.json();
}

export interface AdminAreaRequest {
  id: string;
  region_name: string;
  city_name: string;
  area_name: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
  requested_by: { id: string; name: string; username: string } | null;
  reviewed_by: string;
  reviewed_at: string | null;
  rejection_reason: string;
  quarter_name: string;
  /** Existing neighbourhoods in the region that resemble the request. */
  similar: { id: string; name: string; city: string }[];
}

export async function listAdminAreaRequests(
  filters: { status: AdminAreaRequestStatus; q?: string; page?: number },
  accessToken: string
): Promise<{ count: number; next: string | null; results: AdminAreaRequest[] }> {
  const params = new URLSearchParams({ status: filters.status });
  if (filters.q) params.set("q", filters.q);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const res = await fetch(`${API_BASE_URL}/api/admin/area-suggestions/?${params.toString()}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`Area requests fetch failed: ${res.status}`);
  return res.json();
}

export async function approveAdminAreaRequest(id: string, names: { area_name: string; city_name: string }, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/area-suggestions/${id}/approve/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify(names),
  });
}

export async function rejectAdminAreaRequest(id: string, reason: string, accessToken: string) {
  return fetch(`${API_BASE_URL}/api/admin/area-suggestions/${id}/reject/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(accessToken) }, body: JSON.stringify({ reason }),
  });
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

export const RIDE_ISSUE_CATEGORIES = [
  "FARE", "ROUTE", "DRIVER_BEHAVIOUR", "RIDER_BEHAVIOUR", "VEHICLE", "LOST_ITEM", "DAMAGE", "OTHER",
] as const;
export type RideIssueCategory = (typeof RIDE_ISSUE_CATEGORIES)[number];

export interface RideIssueReport {
  id: number;
  ride: string;
  reported_by: AdminSosPerson | null;
  reporter_role: "RIDER" | "DRIVER";
  category: RideIssueCategory;
  description: string;
  status: "OPEN" | "RESOLVED";
  created_at: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution_notes: string;
}

export interface AdminRideIssue extends RideIssueReport {
  ride_summary: { pickup_description: string; dropoff_description: string; status: string; fare_estimate_xaf: string; requested_at: string };
}

export interface AdminRide {
  id: string;
  status: string;
  ride_category: string;
  transport_type: string;
  pickup_description: string;
  dropoff_description: string;
  fare_estimate_xaf: string;
  requested_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  sos_raised_at: string | null;
  sos_resolved_at: string | null;
  rider: AdminSosPerson | null;
  driver: AdminSosPerson | null;
  open_issue_count: number;
}

export interface AdminRideDetail extends AdminRide {
  vehicle_details: { vehicle_category: string; make: string; model: string; plate_number: string } | null;
  distance_km: string | null;
  has_luggage: boolean;
  luggage_count: number | null;
  luggage_size: string;
  cargo_description: string;
  pickup_latitude: string | null;
  pickup_longitude: string | null;
  dropoff_latitude: string | null;
  dropoff_longitude: string | null;
  cancellation_reason: string;
  cancellation_note: string;
  release_reason: string;
  release_note: string;
  sos_raised_by: AdminSosPerson | null;
  sos_latitude: string | null;
  sos_longitude: string | null;
  sos_note: string;
  payment: { booking_id: string; booking_status: string; amount_xaf: string; escrow_status: string | null; provider_reference: string | null } | null;
  messages: { id: number; sender: string; sender_name: string; text: string; created_at: string }[];
  issue_reports: RideIssueReport[];
}

export async function listAdminRides(
  accessToken: string,
  filters: { q?: string; status?: string; hasOpenIssue?: boolean; page?: number } = {},
): Promise<{ count: number; next: string | null; results: AdminRide[] }> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.hasOpenIssue) params.set("has_issue", "open");
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const res = await fetch(`${API_BASE_URL}/api/admin/rides/?${params}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new ApiStatusError(`Rides fetch failed: ${res.status}`, res.status);
  return res.json();
}

export async function getAdminRide(rideId: string, accessToken: string): Promise<AdminRideDetail> {
  const res = await fetch(`${API_BASE_URL}/api/admin/rides/${rideId}/`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new ApiStatusError(`Ride fetch failed: ${res.status}`, res.status);
  return res.json();
}

export async function listAdminRideIssues(
  accessToken: string,
  status: "open" | "resolved" | "all" = "open",
): Promise<{ count: number; results: AdminRideIssue[] }> {
  const res = await fetch(`${API_BASE_URL}/api/admin/ride-issues/?status=${status}`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new ApiStatusError(`Ride issues fetch failed: ${res.status}`, res.status);
  return res.json();
}

export async function resolveAdminRideIssue(issueId: number, notes: string, accessToken: string): Promise<AdminRideIssue> {
  const res = await fetch(`${API_BASE_URL}/api/admin/ride-issues/${issueId}/resolve/`, {
    method: "POST",
    headers: { ...adminHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not resolve this report");
  return data;
}

export async function reportRideIssue(
  rideId: string,
  payload: { category: RideIssueCategory; description: string },
  accessToken: string,
): Promise<RideIssueReport> {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/report-issue/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.description?.[0] || "Could not send your report");
  return data;
}

export async function listAdminUsers(
  accessToken: string,
  accountStatus?: string,
  role?: string,
  page?: number,
  search?: string
): Promise<{ count: number; next: string | null; previous: string | null; results: AdminUser[] }> {
  const params = new URLSearchParams();
  if (accountStatus) params.set("account_status", accountStatus);
  if (role) params.set("role", role);
  if (page) params.set("page", String(page));
  if (search) params.set("q", search);
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/admin/users/${query}`, { headers: adminHeaders(accessToken) });
  if (!res.ok) throw new Error(`Admin users fetch failed: ${res.status}`);
  return res.json();
}

export interface AdminUserOverview {
  user: AdminUser;
  last_seen_at: string | null;
  language: string;
  kyc: { status: string; legal_name: string; submitted_at: string | null; reviewed_at: string | null };
  wallet: { balance_xaf: string; pending_withdrawals: number; paid_out_xaf: string };
  activity: {
    property_listings: number;
    marketplace_listings: number;
    marketplace_purchases: number;
    marketplace_sales: number;
    bookings: number;
    posts: number;
    support_chats: number;
  };
  reports: { filed: number; against_open: number; against_total: number };
  strikes: { number: number; reason: string; issued_at: string; issued_by: string }[];
}

export async function getAdminUserOverview(userId: string, accessToken: string): Promise<AdminUserOverview> {
  const res = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/overview/`, { headers: adminHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error(`User overview fetch failed: ${res.status}`);
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
  /** PROPERTY searches watch property listings; MARKETPLACE searches hold the marketplace browse query (+ category). */
  scope?: "PROPERTY" | "MARKETPLACE";
  last_notified_at: string | null;
}

export async function listSavedSearches(accessToken: string): Promise<{ count: number; results: SavedSearch[] }> {
  const res = await fetch(`${API_BASE_URL}/api/saved-searches/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Could not fetch saved searches");
  return res.json();
}

export async function createSavedSearch(name: string, filters: Record<string, string>, accessToken: string, scope: "PROPERTY" | "MARKETPLACE" = "PROPERTY") {
  const res = await fetch(`${API_BASE_URL}/api/saved-searches/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name, filters, scope }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Could not create saved search");
  }
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

export interface NotificationTarget {
  kind: string;
  id: string | number;
  role?: string;
  category?: string;
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
  target?: NotificationTarget | null;
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
  is_mine: boolean;
  my_reaction: string | null;
  is_verified_creator: boolean;
  poster_role: string;
  post_type: string;
  caption: string;
  tag_names: string[];
  media: { id: string; media_type: "PHOTO" | "VIDEO" | "AUDIO" | string; file_url: string }[];
  linked_listing_id: string | null;
  status: string;
  published_at: string | null;
  created_at: string;
  reaction_counts: Record<string, number>;
  comment_count: number;
  is_sponsored: boolean;
}

export interface SocialPostPage {
  count: number;
  next: string | null;
  results: SocialPost[];
}

async function fetchPostPage(path: string, page: number, accessToken?: string): Promise<SocialPostPage> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${API_BASE_URL}${path}${page > 1 ? `${separator}page=${page}` : ""}`;
  let res = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, cache: "no-store" });
  // A dead session must not take down a public feed: retry as an anonymous visitor.
  if (res.status === 401 && accessToken) res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load posts");
  const data = await res.json();
  return { count: data.count ?? 0, next: data.next ?? null, results: data.results ?? [] };
}

export function listFeedPosts(accessToken?: string, page = 1): Promise<SocialPostPage> {
  return fetchPostPage("/api/posts/", page, accessToken);
}

export function listFollowingFeed(accessToken: string, page = 1): Promise<SocialPostPage> {
  return fetchPostPage("/api/posts/following/", page, accessToken);
}

export function listMyPosts(accessToken: string, page = 1): Promise<SocialPostPage> {
  return fetchPostPage("/api/posts/mine/", page, accessToken);
}

export function listTopicFeed(tag: string, accessToken?: string, page = 1): Promise<SocialPostPage> {
  return fetchPostPage(`/api/posts/topic/?tag=${encodeURIComponent(tag)}`, page, accessToken);
}

export function searchPosts(query: string, accessToken?: string, page = 1): Promise<SocialPostPage> {
  return fetchPostPage(`/api/posts/search/?q=${encodeURIComponent(query)}`, page, accessToken);
}

// ---------------------------------------------------------------------------
// Video feed (TikTok-style reels)
// ---------------------------------------------------------------------------
export interface ReelListingPreview {
  id: string;
  listing_type: "RENT" | "SALE" | string;
  property_type: string;
  price_xaf: string;
  quarter: string;
  cover_url: string | null;
  is_available: boolean;
}

export interface ReelPost extends SocialPost {
  author_username: string;
  author_avatar: string | null;
  is_following_author: boolean;
  is_saved: boolean;
  share_count: number;
  view_count: number;
  listing_preview: ReelListingPreview | null;
}

export interface ReelPage {
  count: number;
  next: string | null;
  results: ReelPost[];
}

export type ReelScope = "for_you" | "following" | "trending" | "saved";
export type ReelKind = "all" | "rent" | "sale" | "property" | "general";

export interface ReelQuery {
  scope?: ReelScope;
  q?: string;
  tag?: string;
  kind?: ReelKind;
  listing?: string;
  author?: string;
}

const bearer = (accessToken?: string): Record<string, string> => (accessToken ? { Authorization: "Bearer " + accessToken } : {});

export async function listReels(query: ReelQuery, accessToken?: string, page = 1): Promise<ReelPage> {
  const params = new URLSearchParams();
  if (query.scope) params.set("scope", query.scope);
  if (query.q) params.set("q", query.q);
  if (query.tag) params.set("tag", query.tag);
  if (query.kind && query.kind !== "all") params.set("kind", query.kind);
  if (query.listing) params.set("listing", query.listing);
  if (query.author) params.set("author", query.author);
  if (page > 1) params.set("page", String(page));
  const url = `${API_BASE_URL}/api/posts/reels/?${params.toString()}`;
  let res = await fetch(url, { headers: bearer(accessToken), cache: "no-store" });
  // A dead session must not take down a public feed: retry as an anonymous visitor.
  if (res.status === 401 && accessToken) res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load videos");
  const data = await res.json();
  return { count: data.count ?? 0, next: data.next ?? null, results: data.results ?? [] };
}

export async function getReel(postId: string, accessToken?: string): Promise<ReelPost> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/reel/`, { headers: bearer(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error("Could not load video");
  return res.json();
}

export async function listTrendingVideoTags(): Promise<{ name: string; count: number }[]> {
  const res = await fetch(`${API_BASE_URL}/api/posts/trending-tags/`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function recordReelView(postId: string, accessToken?: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/posts/${postId}/view/`, { method: "POST", headers: bearer(accessToken) }).catch(() => undefined);
}

export async function toggleSaveReel(postId: string, accessToken: string): Promise<{ saved: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/save/`, { method: "POST", headers: bearer(accessToken) });
  if (!res.ok) throw new Error("Could not save video");
  return res.json();
}

export async function recordReelShare(postId: string, channel: "WHATSAPP" | "FACEBOOK" | "SMS" | "IN_APP", accessToken: string): Promise<{ share_count: number }> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/share/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(accessToken) },
    body: JSON.stringify({ channel }),
  });
  if (!res.ok) throw new Error("Could not record share");
  return res.json();
}

export type CreatePostErrorKind = "moderation" | "validation" | "network" | "auth";

export class CreatePostError extends Error {
  kind: CreatePostErrorKind;
  constructor(message: string, kind: CreatePostErrorKind) {
    super(message);
    this.kind = kind;
  }
}

export async function createPost(
  payload: { caption: string; post_type?: "STANDARD" | "REEL"; tags?: string[]; linked_listing_id?: string; media_urls?: string[] },
  accessToken: string
): Promise<{ id: string } & Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/posts/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new CreatePostError("Could not reach the server", "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Still 401 after the one automatic refresh: the sign-in has really ended.
    if (res.status === 401) throw new CreatePostError("Your session has expired — please sign in again.", "auth");
    // A `detail` on a 400 is the moderation gate; DRF field errors come back keyed by field instead.
    if (res.status === 400 && typeof data.detail === "string") throw new CreatePostError(data.detail, "moderation");
    const firstFieldError = Object.values(data).flat()[0];
    throw new CreatePostError(typeof firstFieldError === "string" ? firstFieldError : "Could not create post", "validation");
  }
  return data;
}

export async function deletePost(postId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not delete post");
}

export async function reactToPost(postId: string, emoji: string, accessToken: string): Promise<SocialPost> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/react/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw new Error("Could not react to post");
  return res.json();
}

export async function removePostReaction(postId: string, accessToken: string): Promise<SocialPost> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/remove-reaction/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not remove reaction");
  return res.json();
}

export type PostReportReason = "INAPPROPRIATE_CONTENT" | "SCAM_SUSPECTED" | "HARASSMENT" | "OTHER";

export async function reportPost(postId: string, reason: PostReportReason, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/content-reports/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ target_post: postId, reason }),
  });
  if (!res.ok) throw new Error("Could not file report");
}

export interface PostComment {
  id: string;
  post: string;
  author: string;
  author_name: string;
  is_mine: boolean;
  text: string;
  created_at: string;
}

export async function getPostComments(postId: string, accessToken?: string): Promise<PostComment[]> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/comments/`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new Error("Could not fetch comments");
  return res.json();
}

export async function addPostComment(postId: string, text: string, accessToken: string): Promise<PostComment> {
  const res = await fetch(`${API_BASE_URL}/api/comments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ post: postId, text }),
  });
  if (!res.ok) throw new Error("Could not add comment");
  return res.json();
}

export async function deletePostComment(commentId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/comments/${commentId}/`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not delete comment");
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
  accept_terms: boolean;
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

/** Sign-in needs a second step: a code was just sent to the person's phone or email. */
export class MfaRequiredError extends Error {
  constructor(public challengeId: string, public method: string, public destinationHint: string) {
    super("A verification code is required");
    this.name = "MfaRequiredError";
  }
}

/** Throws MfaRequiredError when the account has two-factor sign-in; finish with completeMfaLogin. */
export async function loginUser(username: string, password: string): Promise<{ access: string; refresh: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 202) {
    const data = await res.json();
    throw new MfaRequiredError(data.challenge_id, data.method, data.destination_hint);
  }
  if (!res.ok) throw new Error("Invalid username or password");
  return res.json();
}

export async function completeMfaLogin(challengeId: string, code: string): Promise<{ access: string; refresh: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/mfa/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
  if (!res.ok) throw new Error("Incorrect or expired code");
  return res.json();
}

// ---------------------------------------------------------------------------
// Job postings — mirrors the real backend API exactly.
// ---------------------------------------------------------------------------
export interface JobPosting {
  id: string;
  posted_by: string;
  posted_by_name: string;
  company_name?: string;
  title: string;
  role_category: string;
  employment_type?: string;
  workplace_type?: string;
  description: string;
  quarter: string | null;
  quarter_name: string | null;
  city_name?: string | null;
  salary_min_xaf: string | null;
  salary_max_xaf: string | null;
  status: string;
  posted_at: string;
  closes_at: string | null;
  application_count: number;
  is_open: boolean;
  /** The signed-in viewer's own application status for this job; null if they haven't applied. */
  my_application_status: string | null;
}

export const JOB_ROLE_CATEGORIES = ["PROPERTY_MANAGER", "AGENT", "HOSTEL_WARDEN", "MAINTENANCE_STAFF", "DRIVER", "OTHER"] as const;
export const JOB_EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP"] as const;
export const JOB_WORKPLACE_TYPES = ["ON_SITE", "HYBRID", "REMOTE"] as const;

export interface JobPostingFilters {
  q?: string;
  roleCategory?: string;
  employmentType?: string;
  workplaceType?: string;
  quarter?: string;
  page?: number;
}

/** Public list of open jobs. `token` only adds the viewer's own application status to each one. */
export async function listJobPostings(filters: JobPostingFilters = {}, accessToken?: string): Promise<{ count: number; next: string | null; results: JobPosting[] }> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.roleCategory) params.set("role_category", filters.roleCategory);
  if (filters.employmentType) params.set("employment_type", filters.employmentType);
  if (filters.workplaceType) params.set("workplace_type", filters.workplaceType);
  if (filters.quarter) params.set("quarter", filters.quarter);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const res = await fetch(`${API_BASE_URL}/api/jobs/${params.size ? `?${params}` : ""}`, accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined);
  if (!res.ok) throw new Error(`Job postings fetch failed: ${res.status}`);
  return res.json();
}

/** Fetches a single job posting by UUID (including closed ones for shared deep-links), or null if not found. */
export async function getJobPosting(jobId: string): Promise<JobPosting | null> {
  if (!/^[0-9a-fA-F-]{32,36}$/.test(jobId)) return null;
  const res = await fetch(`${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}/`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Job posting fetch failed: ${res.status}`);
  return res.json();
}

export interface JobApplyInput {
  coverMessage?: string;
  yearsExperience?: number | null;
  cvFile?: File | null;
}

export async function applyToJob(
  jobId: string,
  inputOrMessage: string | JobApplyInput,
  accessToken: string,
): Promise<JobApplicationItem> {
  const input: JobApplyInput =
    typeof inputOrMessage === "string" ? { coverMessage: inputOrMessage } : inputOrMessage;

  let res: Response;
  if (input.cvFile) {
    const formData = new FormData();
    if (input.coverMessage) formData.append("cover_message", input.coverMessage);
    if (input.yearsExperience !== null && input.yearsExperience !== undefined) {
      formData.append("years_experience", String(input.yearsExperience));
    }
    formData.append("cv_file", input.cvFile);
    res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/apply/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
  } else {
    const payload: Record<string, unknown> = { cover_message: input.coverMessage ?? "" };
    if (input.yearsExperience !== null && input.yearsExperience !== undefined) {
      payload.years_experience = input.yearsExperience;
    }
    res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/apply/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(jobErrorMessage(data, "Could not submit application"));
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
  security_deposit_xaf: string;
  quarter: string | null;
  quarter_name: string | null;
  latitude: string | null;
  longitude: string | null;
  availability_status: string;
  created_at: string;
  media: MarketplaceMediaItem[];
  /** Present (kilometres) only when the list was searched near a point. */
  distance_km?: number | null;
  /** Listings leave the marketplace this long after their last renewal unless the lister renews them. */
  expires_at?: string;
  is_expired?: boolean;
  /** Buyers may propose a lower price (the lister can switch this off). */
  allow_offers?: boolean;
  /** A paid TOP boost is running until boosted_until. */
  is_boosted?: boolean;
  boosted_until?: string | null;
  /** Flash sales (goods only): what one unit costs while the sale runs. */
  sale_price_xaf?: string | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  on_sale?: boolean;
  /** What one unit costs right now: the sale price while a sale runs, else the normal price. */
  current_price_xaf?: string;
  seller_on_vacation?: boolean;
}

/** Views, saves and chats on one of the caller's own listings (from the /mine/ lists). */
export interface ListingStats {
  views: number;
  saves: number;
  chats: number;
}

export interface MarketplaceSellerSummary {
  id: string;
  name: string;
  member_since: string;
  id_verified: boolean;
  rating_avg: number | null;
  rating_count: number;
  items_sold: number;
  active_listings: number;
  /** null until the seller has enough conversations for it to mean something. */
  reply_rate_pct: number | null;
  reply_time_hours: number | null;
  last_seen_at: string | null;
}

export async function getMarketplaceSeller(userId: string): Promise<MarketplaceSellerSummary> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-sellers/${userId}/`, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the seller");
  return res.json();
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
export const CAR_BODY_TYPES = ["SEDAN", "HATCHBACK", "SUV", "PICKUP", "WAGON", "COUPE", "CONVERTIBLE", "VAN", "MINIBUS", "BUS", "TRUCK", "OTHER"] as const;
export const CAR_FUEL_TYPES = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "GAS"] as const;
export const CAR_TRANSMISSIONS = ["AUTOMATIC", "MANUAL"] as const;
export const CAR_DRIVETRAINS = ["FWD", "RWD", "AWD", "4WD"] as const;
export const CAR_CONDITIONS = ["NEW", "FOREIGN_USED", "LOCALLY_USED"] as const;
export const CAR_DRIVER_OPTIONS = ["SELF_DRIVE", "WITH_DRIVER", "EITHER"] as const;
export const CAR_FUEL_POLICIES = ["SAME_LEVEL", "FULL_TO_FULL", "INCLUDED"] as const;
export const CAR_FEATURES = [
  "AIR_CONDITIONING", "BLUETOOTH", "REVERSE_CAMERA", "PARKING_SENSORS", "NAVIGATION", "LEATHER_SEATS",
  "SUNROOF", "CRUISE_CONTROL", "KEYLESS_ENTRY", "ALLOY_WHEELS", "POWER_WINDOWS", "THIRD_ROW_SEATS",
  "TOW_HITCH", "ROOF_RACK", "CHILD_SEAT", "USB_CHARGER",
] as const;
/** Cars are either sold or rented by the day (the backend's RENT_NIGHTLY basis). */
export const CAR_DAILY_BASIS = "RENT_NIGHTLY";

export interface VehicleSpec {
  make: string;
  model: string;
  year: number;
  mileage_km: number | null;
  engine_size_cc: number | null;
  trim?: string;
  body_type?: string;
  fuel_type?: string;
  transmission?: string;
  drivetrain?: string;
  exterior_color?: string;
  interior_color?: string;
  doors?: number | null;
  seats?: number | null;
  vehicle_condition?: string;
  customs_cleared?: boolean | null;
  registration_in_seller_name?: boolean | null;
  previous_owners?: number | null;
  accident_free?: boolean | null;
  service_history?: boolean | null;
  features?: string[];
  /** The full chassis number, only for the lister; everyone else gets "". */
  vin?: string;
  /** "…123456": the last 6 characters, shown to everyone. */
  vin_last6?: string;
}
export interface CarListing extends BaseMarketplaceListing {
  vehicle_spec: VehicleSpec;
  price_negotiable?: boolean;
  driver_option?: string;
  driver_fee_per_day_xaf?: string;
  weekly_discount_pct?: number;
  monthly_discount_pct?: number;
  min_rental_days?: number;
  max_rental_days?: number | null;
  daily_km_limit?: number | null;
  extra_km_fee_xaf?: string | null;
  fuel_policy?: string;
  min_driver_age?: number | null;
  min_licence_years?: number | null;
  insurance_included?: boolean;
  delivery_available?: boolean;
  delivery_fee_xaf?: string;
  out_of_town_allowed?: boolean;
  /** false: each booking is a request the owner accepts or declines. */
  instant_book?: boolean;
}

export interface CarBusyPeriod {
  start: string;
  /** The return day: the period runs up to but not including it. */
  end: string;
  /** Owner only. */
  kind?: "booked" | "blocked";
  id?: string | null;
  note?: string;
}

export interface CarRentalQuote {
  start_date: string;
  end_date: string;
  days: number;
  with_driver: boolean;
  delivery: boolean;
  daily_rate_xaf: string;
  base_xaf: string;
  discount_pct: number;
  discount_xaf: string;
  driver_fee_xaf: string;
  delivery_fee_xaf: string;
  rent_total_xaf: string;
  deposit_xaf: string;
  total_xaf: string;
}

function bearerHeaders(accessToken?: string | null): HeadersInit {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export async function getCarAvailability(carId: string, accessToken?: string | null): Promise<{ busy: CarBusyPeriod[]; min_rental_days: number; max_rental_days: number | null }> {
  const res = await fetch(`${API_BASE_URL}/api/cars/${carId}/availability/`, { headers: bearerHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the car's calendar");
  return res.json();
}

export async function getCarQuote(carId: string, params: { start: string; end: string; withDriver: boolean; delivery: boolean }): Promise<CarRentalQuote> {
  const query = new URLSearchParams({
    start_date: params.start, end_date: params.end, with_driver: String(params.withDriver), delivery: String(params.delivery),
  });
  const res = await fetch(`${API_BASE_URL}/api/cars/${carId}/quote/?${query}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Those dates can't be booked");
  return data;
}

export async function getSimilarCars(carId: string): Promise<CarListing[]> {
  const res = await fetch(`${API_BASE_URL}/api/cars/${carId}/similar/`, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load similar cars");
  return res.json();
}

export async function getSimilarListings(category: MarketplaceCategory, id: string): Promise<AnyMarketplaceListing[]> {
  const res = await fetch(`${API_BASE_URL}/api/${category}/${id}/similar/`, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load similar items");
  return res.json();
}

export async function renewMarketplaceListing(category: MarketplaceCategory, id: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/${category}/${id}/renew/`, { method: "POST", headers: bearerHeaders(accessToken) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not renew the listing");
  return data as { id: string; expires_at: string; is_expired: boolean };
}

export async function blockCarDates(carId: string, payload: { starts_on: string; ends_on: string; note?: string }, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/cars/${carId}/blocked-dates/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearerHeaders(accessToken) },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Could not block those days"));
  }
  return data;
}

export async function unblockCarDates(carId: string, periodId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/cars/${carId}/blocked-dates/${periodId}/`, { method: "DELETE", headers: bearerHeaders(accessToken) });
  if (!res.ok) throw new Error("Could not unblock those days");
}

export async function removeMarketplaceMedia(category: MarketplaceCategory, listingId: string, mediaId: number, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/${category}/${listingId}/remove-media/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearerHeaders(accessToken) },
    body: JSON.stringify({ media_id: mediaId }),
  });
  if (!res.ok) throw new Error("Could not remove the photo");
}

export const GOODS_CATEGORIES = [
  "ELECTRONICS", "PHONES", "FASHION", "HOME", "APPLIANCES", "FOOD", "BUILDING", "TOOLS", "VEHICLE_PARTS", "BABY", "SPORTS", "OTHER",
] as const;
export const GOODS_CONDITIONS = ["NEW", "LIKE_NEW", "USED"] as const;
export type GoodsCategory = (typeof GOODS_CATEGORIES)[number];
export type GoodsCondition = (typeof GOODS_CONDITIONS)[number];

export interface GoodsVariant {
  id: string;
  /** e.g. "Red / M". */
  label: string;
  options: Record<string, string>;
  sku: string;
  /** The final unit price of this version, flash sale included, in whole XAF. */
  price_xaf: string;
  price_delta_xaf: string;
  quantity: number;
  available: boolean;
  photo_url: string | null;
  is_active: boolean;
}

export interface GoodsListing extends BaseMarketplaceListing {
  item_category: GoodsCategory;
  condition: GoodsCondition;
  /** Units in stock; each paid order takes its units and the listing is sold out at 0. With options it is the total across versions. */
  quantity: number;
  /** A display-only "was" price, always above price_xaf. */
  compare_at_price_xaf?: string | null;
  has_variants?: boolean;
  /** The cheapest in-stock version, when the listing has options. */
  price_from_xaf?: string | null;
  variants?: GoodsVariant[];
  pickup_available?: boolean;
  seller_delivery?: boolean;
  seller_delivery_fee_xaf?: string;
  seller_delivery_areas?: string;
  courier_shipping?: boolean;
  courier_fee_xaf?: string;
  courier_note?: string;
}

/** The fields every category's browse card needs, whichever category the listing belongs to. */
export type AnyMarketplaceListing = BaseMarketplaceListing & Partial<WarehouseListing> & Partial<StoreListing> & Partial<BusinessListing> & Partial<CarListing> & Partial<GoodsListing>;

export const MARKETPLACE_CATEGORIES = ["goods", "cars", "stores", "warehouses", "businesses"] as const;

const MARKETPLACE_ENDPOINTS = { warehouses: "warehouses", stores: "stores", businesses: "businesses", cars: "cars", goods: "goods" } as const;
export type MarketplaceCategory = keyof typeof MARKETPLACE_ENDPOINTS;

export async function listMarketplaceListings<T>(category: MarketplaceCategory, filters?: Record<string, string>): Promise<{ count: number; results: T[] }> {
  const query = filters ? `?${new URLSearchParams(filters).toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${query}`);
  if (!res.ok) throw new Error(`${category} fetch failed: ${res.status}`);
  return res.json();
}

export async function listMarketplaceFeed<T>(filters?: Record<string, string>): Promise<{ count: number; results: T[] }> {
  const query = filters ? `?${new URLSearchParams(filters).toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/marketplace-feed/${query}`);
  if (!res.ok) throw new Error(`marketplace feed fetch failed: ${res.status}`);
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

export interface GoodsVariantInput {
  id?: string;
  /** 1-3 option names with the same names, in the same order, in every row. */
  options: Record<string, string>;
  /** Whole XAF added to (or, if negative, taken off) the listing price. */
  price_delta_xaf: number;
  quantity: number;
  sku?: string;
  photo_url?: string;
  is_active?: boolean;
}

export interface GoodsVariantFieldError {
  index?: number;
  field: string;
  message: string;
}

/** A rejected options save: `errors` points at the offending rows and fields. */
export class GoodsVariantsError extends Error {
  errors: GoodsVariantFieldError[];
  constructor(message: string, errors: GoodsVariantFieldError[]) {
    super(message);
    this.errors = errors;
  }
}

export async function getGoodsVariants(listingId: string, accessToken?: string): Promise<GoodsVariant[]> {
  const res = await fetch(`${API_BASE_URL}/api/goods/${listingId}/variants/`, { headers: accessToken ? bearerHeaders(accessToken) : undefined, cache: "no-store" });
  const data = await jsonOrThrow<{ variants: GoodsVariant[] }>(res, "Could not load the options");
  return data.variants ?? [];
}

/** Replaces the whole set of options of a goods listing; an empty list removes them all. */
export async function saveGoodsVariants(listingId: string, variants: GoodsVariantInput[], accessToken: string): Promise<{ variants: GoodsVariant[]; quantity: number }> {
  const res = await fetch(`${API_BASE_URL}/api/goods/${listingId}/variants/`, {
    method: "PUT", headers: jsonAuth(accessToken), body: JSON.stringify({ variants }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errors = Array.isArray(data?.errors) ? (data.errors as GoodsVariantFieldError[]) : [];
    throw new GoodsVariantsError(apiErrorMessage(data, "Could not save the options"), errors);
  }
  return data as { variants: GoodsVariant[]; quantity: number };
}

export type MarketplaceOrderStatus = "PAYMENT_PENDING" | "PAID" | "HANDED_OVER" | "COMPLETED" | "CANCELLED" | "DISPUTED";

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
  deposit_xaf: string;
  deposit_status: "NONE" | "HELD" | "CLAIMED" | "RETURNED" | "FORFEITED";
  deposit_settled_at: string | null;
  deposit_return_by: string | null;
  total_xaf: string;
  rental_starts_on: string | null;
  rental_ends_on: string | null;
  booked_dates?: boolean;
  rental_days?: number | null;
  with_driver?: boolean;
  delivery_requested?: boolean;
  price_breakdown?: Partial<CarRentalQuote>;
  /** A car booked for dates is free to cancel until this moment; later, one day's rent goes to the owner. */
  free_cancellation_until?: string | null;
  /** A booking request on a car without instant booking. */
  needs_approval?: boolean;
  owner_approved_at?: string | null;
  /** Set while the request is unanswered: it expires (and is refunded) at this moment. */
  approval_deadline?: string | null;
  /** The buyer of a completed order can leave a verified-purchase review once. */
  can_review?: boolean;
  my_review?: { score: number; text: string; created_at: string } | null;
  delivery_method?: MarketplaceDeliveryMethod;
  delivery_address?: string;
  courier_name?: string;
  tracking_number?: string;
  shipment_status?: MarketplaceShipmentStatus | "";
  shipped_at?: string | null;
  delivered_at?: string | null;
  delivery_proof_url?: string;
  delivery_note?: string;
  shipment_events?: MarketplaceShipmentEvent[];
  /** The order is delivered by the seller or a courier, so shipment updates apply. */
  is_tracked?: boolean;
  receipt_available?: boolean;
  return_request?: MarketplaceReturnRequest | null;
  can_request_return?: boolean;
  discount_xaf?: string;
  coupon_code?: string;
  /** The cart checkout (one Mobile Money payment) this order was split from, or null. */
  checkout?: string | null;
  /** The chosen version of a goods listing with options ("Red / M"), or "". */
  variant_label?: string;
}

export type MarketplaceDeliveryMethod = "PICKUP" | "SELLER" | "COURIER" | "";
export type MarketplaceShipmentStatus = "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED";

export interface MarketplaceShipmentEvent {
  status: MarketplaceShipmentStatus | "REPLACEMENT";
  note: string;
  at: string;
}

export type MarketplaceReturnKind = "REFUND" | "PARTIAL_REFUND" | "REPLACEMENT";
export type MarketplaceReturnReason = "NOT_AS_DESCRIBED" | "DAMAGED" | "WRONG_ITEM" | "MISSING_PARTS" | "NOT_WORKING" | "OTHER";
export type MarketplaceReturnStatus = "REQUESTED" | "ACCEPTED" | "REJECTED" | "ESCALATED" | "WITHDRAWN" | "CLOSED";

export interface MarketplaceReturnRequest {
  id: string;
  kind: MarketplaceReturnKind;
  reason: MarketplaceReturnReason;
  description: string;
  evidence_urls: string[];
  requested_amount_xaf: string | null;
  status: MarketplaceReturnStatus;
  seller_note: string;
  created_at: string;
  responded_at: string | null;
  /** The seller must answer by then, or the request goes to support. */
  respond_by: string | null;
  /** After a rejection the buyer must decide by then. */
  buyer_decide_by: string | null;
}

export interface MarketplaceReviewItem {
  id: number;
  author_name: string;
  score: number;
  text: string;
  created_at: string;
  verified_purchase: boolean;
}

export interface MarketplaceReviews {
  average: number | null;
  count: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  results: MarketplaceReviewItem[];
}

export async function getMarketplaceListingReviews(category: MarketplaceCategory, id: string): Promise<MarketplaceReviews> {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/reviews/`, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the reviews");
  return res.json();
}

export async function reviewMarketplaceOrder(orderId: string, score: number, text: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/${orderId}/review/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ score, text }),
  });
  return marketplaceOrderResponse(res, "Could not save your review");
}

async function marketplaceOrderResponse(res: Response, fallback: string): Promise<MarketplaceOrderItem> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : fallback));
  }
  return data;
}

export async function placeMarketplaceOrder(
  category: MarketplaceCategory, listingId: string, phoneNumber: string, accessToken: string,
  rental?: { start_date: string; end_date: string; with_driver: boolean; delivery: boolean },
  goods?: { quantity: number; variant_id?: string; delivery_method?: "PICKUP" | "SELLER" | "COURIER"; delivery_address?: string },
  offerId?: string,
  options?: { coupon_code?: string },
) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      category, listing_id: listingId, phone_number: phoneNumber, ...rental, ...goods,
      ...(offerId ? { offer_id: offerId } : {}), ...(options?.coupon_code ? { coupon_code: options.coupon_code } : {}),
    }),
  });
  return marketplaceOrderResponse(res, "Could not place the order");
}

/** The first readable message in a DRF error body: {detail}, else the first field error. */
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    const first = Object.values(record).flat()[0];
    if (typeof first === "string") return first;
  }
  return fallback;
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, fallback));
  return data as T;
}

function jsonAuth(accessToken: string): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };
}

// --- Cart: one Mobile Money payment per seller, split into one order per item once paid. ---

export interface MarketplaceCartItem {
  listing_id: string;
  /** The chosen version of an item with options; one cart line per listing + version. */
  variant_id: string | null;
  variant_label: string;
  title: string;
  photo_url: string | null;
  unit_price_xaf: string;
  list_price_xaf: string;
  on_sale: boolean;
  sale_ends_at: string | null;
  quantity: number;
  stock: number;
  available: boolean;
  reason: string;
  line_total_xaf: string;
}

export interface MarketplaceCartGroup {
  seller_id: string;
  seller_name: string;
  subtotal_xaf: string;
  can_checkout: boolean;
  delivery_options: { method: "PICKUP" | "SELLER" | "COURIER"; fee_xaf: string }[];
  items: MarketplaceCartItem[];
}

export interface MarketplaceCart {
  item_count: number;
  groups: MarketplaceCartGroup[];
}

export interface MarketplaceCartQuote {
  subtotal_xaf: string;
  discount_xaf: string;
  delivery_fee_xaf: string;
  total_xaf: string;
  delivery_method: string;
  coupon_error: string | null;
}

export interface MarketplaceCartRequest {
  seller_id: string;
  delivery_method: "PICKUP" | "SELLER" | "COURIER";
  delivery_address?: string;
  coupon_code?: string;
}

export async function getMarketplaceCart(accessToken: string): Promise<MarketplaceCart> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-cart/`, { headers: bearerHeaders(accessToken), cache: "no-store" });
  return jsonOrThrow(res, "Could not load your cart");
}

export async function setMarketplaceCartItem(listingId: string, quantity: number, accessToken: string, variantId?: string | null): Promise<MarketplaceCart> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-cart/items/`, {
    method: "POST", headers: jsonAuth(accessToken),
    body: JSON.stringify({ listing_id: listingId, quantity, ...(variantId ? { variant_id: variantId } : {}) }),
  });
  return jsonOrThrow(res, "Could not update your cart");
}

export async function removeMarketplaceCartItem(listingId: string, accessToken: string, variantId?: string | null): Promise<MarketplaceCart> {
  const query = variantId ? `?variant_id=${encodeURIComponent(variantId)}` : "";
  const res = await fetch(`${API_BASE_URL}/api/marketplace-cart/items/${listingId}/${query}`, { method: "DELETE", headers: bearerHeaders(accessToken) });
  return jsonOrThrow(res, "Could not update your cart");
}

export async function quoteMarketplaceCart(request: MarketplaceCartRequest, accessToken: string): Promise<MarketplaceCartQuote> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-cart/quote/`, {
    method: "POST", headers: jsonAuth(accessToken), body: JSON.stringify(request),
  });
  return jsonOrThrow(res, "Could not price your cart");
}

export async function checkoutMarketplaceCart(
  request: MarketplaceCartRequest & { phone_number: string }, accessToken: string,
): Promise<{ checkout_id: string; total_xaf: string; orders: MarketplaceOrderItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-cart/checkout/`, {
    method: "POST", headers: jsonAuth(accessToken), body: JSON.stringify(request),
  });
  return jsonOrThrow(res, "Could not place the order");
}

// --- Coupons ---

export type MarketplaceCouponKind = "PERCENT" | "FIXED";

export interface MarketplaceCoupon {
  id: number | string;
  code: string;
  kind: MarketplaceCouponKind;
  value: string | number;
  min_order_xaf: string | number;
  max_uses: number | null;
  uses: number;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
}

export type MarketplaceCouponInput = Omit<MarketplaceCoupon, "id" | "uses">;

export async function listMarketplaceCoupons(accessToken: string): Promise<MarketplaceCoupon[]> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupons/`, { headers: bearerHeaders(accessToken), cache: "no-store" });
  const data = await jsonOrThrow<{ results?: MarketplaceCoupon[] } | MarketplaceCoupon[]>(res, "Could not load your coupons");
  return Array.isArray(data) ? data : data.results ?? [];
}

export async function createMarketplaceCoupon(input: Partial<MarketplaceCouponInput>, accessToken: string): Promise<MarketplaceCoupon> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupons/`, { method: "POST", headers: jsonAuth(accessToken), body: JSON.stringify(input) });
  return jsonOrThrow(res, "Could not create the coupon");
}

export async function updateMarketplaceCoupon(id: number | string, input: Partial<MarketplaceCouponInput>, accessToken: string): Promise<MarketplaceCoupon> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupons/${id}/`, { method: "PATCH", headers: jsonAuth(accessToken), body: JSON.stringify(input) });
  return jsonOrThrow(res, "Could not update the coupon");
}

export async function deleteMarketplaceCoupon(id: number | string, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupons/${id}/`, { method: "DELETE", headers: bearerHeaders(accessToken) });
  if (!res.ok) throw new Error("Could not delete the coupon");
}

export interface MarketplaceCouponCheck {
  valid: boolean;
  message: string;
  discount_xaf: string;
  code: string;
}

export async function checkMarketplaceCoupon(listingId: string, quantity: number, code: string, accessToken: string): Promise<MarketplaceCouponCheck> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupon-check/`, {
    method: "POST", headers: jsonAuth(accessToken), body: JSON.stringify({ listing_id: listingId, quantity, code }),
  });
  return jsonOrThrow(res, "Could not check the coupon");
}

// --- Shops ---

export interface MarketplaceShopSettings {
  name: string;
  tagline: string;
  description: string;
  logo_url: string;
  banner_url: string;
  shipping_policy: string;
  return_policy: string;
  announcement: string;
  on_vacation: boolean;
  vacation_message: string;
  vacation_until: string | null;
}

export interface MarketplaceShop extends MarketplaceShopSettings {
  user_id: string;
  seller: MarketplaceSellerSummary;
  listing_count: number;
  deal_count: number;
  coupon_available: boolean;
  follower_count: number;
  is_following: boolean;
  is_owner: boolean;
}

export async function getMarketplaceShop(userId: string, accessToken?: string | null): Promise<MarketplaceShop> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-shops/${userId}/`, { headers: bearerHeaders(accessToken), cache: "no-store" });
  return jsonOrThrow(res, "Could not load the shop");
}

export async function getMyMarketplaceShop(accessToken: string): Promise<MarketplaceShopSettings> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-shop/me/`, { headers: bearerHeaders(accessToken), cache: "no-store" });
  return jsonOrThrow(res, "Could not load your shop");
}

export async function updateMyMarketplaceShop(settings: MarketplaceShopSettings, accessToken: string): Promise<MarketplaceShopSettings> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-shop/me/`, { method: "PUT", headers: jsonAuth(accessToken), body: JSON.stringify(settings) });
  return jsonOrThrow(res, "Could not save your shop");
}

// --- Search assist ---

export interface MarketplaceSearchAssist {
  query: string;
  did_you_mean: string | null;
  synonyms: string[];
}

export async function getMarketplaceSearchAssist(q: string, signal?: AbortSignal): Promise<MarketplaceSearchAssist> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-search/assist/?${new URLSearchParams({ q })}`, { signal });
  return jsonOrThrow(res, "Search suggestions are unavailable");
}

export async function getTrendingMarketplaceSearches(days = 7): Promise<{ term: string; count: number }[]> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-search/trending/?days=${days}`);
  const data = await jsonOrThrow<{ results?: { term: string; count: number }[] }>(res, "Trending searches are unavailable");
  return data.results ?? [];
}

export class VisualSearchError extends Error {
  constructor(message: string, readonly unavailable: boolean) {
    super(message);
  }
}

export async function searchMarketplaceByImage(image: File): Promise<{ keywords: string[]; q: string }> {
  const body = new FormData();
  body.append("image", image);
  const res = await fetch(`${API_BASE_URL}/api/marketplace-search/image/`, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new VisualSearchError(apiErrorMessage(data, "Could not search by photo"), res.status === 503);
  return data;
}

export type MarketplaceOfferStatus = "PENDING" | "COUNTERED" | "ACCEPTED" | "PAID" | "DECLINED" | "WITHDRAWN" | "EXPIRED";

export interface MarketplaceOfferItem {
  id: string;
  listing_id: string;
  listing_title: string;
  listing_price_xaf: string;
  price_basis: string;
  category: MarketplaceCategory | "";
  photo_url: string | null;
  buyer: string;
  buyer_name: string;
  seller: string;
  seller_name: string;
  amount_xaf: string;
  counter_amount_xaf: string | null;
  /** The price to pay: set while the offer is ACCEPTED (or PAID). */
  agreed_amount_xaf: string | null;
  message: string;
  status: MarketplaceOfferStatus;
  created_at: string;
  responded_at: string | null;
  accepted_at: string | null;
  /** An accepted offer must be paid before this moment. */
  pay_by: string | null;
  /** An unanswered offer (or counter-offer) lapses at this moment. */
  respond_by: string | null;
}

/** Offers still going: the buyer can't make another one on the listing until these are settled. */
export const OPEN_OFFER_STATUSES: MarketplaceOfferStatus[] = ["PENDING", "COUNTERED", "ACCEPTED"];

async function marketplaceOfferResponse(res: Response, fallback: string): Promise<MarketplaceOfferItem> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : fallback));
  }
  return data;
}

export async function makeMarketplaceOffer(
  category: MarketplaceCategory, listingId: string, amountXaf: number, message: string, accessToken: string,
) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-offers/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ category, listing_id: listingId, amount_xaf: amountXaf, message }),
  });
  return marketplaceOfferResponse(res, "Could not send your offer");
}

export async function listMyMarketplaceOffers(
  role: "buying" | "selling", accessToken: string, listingId?: string,
): Promise<{ count: number; results: MarketplaceOfferItem[] }> {
  const query = new URLSearchParams({ role, ...(listingId ? { listing_id: listingId } : {}) });
  const res = await fetch(`${API_BASE_URL}/api/marketplace-offers/?${query}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error("Could not load your offers");
  return res.json();
}

export type MarketplaceOfferActionName = "accept" | "decline" | "counter" | "withdraw";

export async function marketplaceOfferAction(offerId: string, action: MarketplaceOfferActionName, accessToken: string, amountXaf?: number) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-offers/${offerId}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(action === "counter" ? { amount_xaf: amountXaf } : {}),
  });
  return marketplaceOfferResponse(res, "That action could not be completed");
}

export interface MarketplaceBoostOption {
  duration_unit: "DAILY" | "MONTHLY";
  unit_price_xaf: string;
  max_quantity: number;
}

export async function getMarketplaceBoostOptions(): Promise<MarketplaceBoostOption[]> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-boost-options/`, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the boost prices");
  return (await res.json()).options;
}

export async function boostMarketplaceListing(
  category: MarketplaceCategory, id: string,
  payload: { duration_unit: "DAILY" | "MONTHLY"; quantity: number; pay_with: "WALLET" | "MOMO"; phone_number?: string },
  accessToken: string,
) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/boost/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ phone_number: "", ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Could not boost the listing"));
  }
  return data as { id: string; boosted_until: string; price_xaf: string };
}

export async function listMyMarketplaceOrders(role: "buying" | "selling", accessToken: string): Promise<{ count: number; results: MarketplaceOrderItem[] }> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/?role=${role}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error("Could not load your orders");
  return res.json();
}

export type MarketplaceOrderActionName = "approve" | "hand-over" | "confirm" | "cancel" | "decline" | "dispute" | "return-deposit" | "claim-deposit";

export async function marketplaceOrderAction(orderId: string, action: MarketplaceOrderActionName, accessToken: string, reason?: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/${orderId}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(action === "dispute" || action === "claim-deposit" ? { reason } : {}),
  });
  return marketplaceOrderResponse(res, "That action could not be completed");
}

export interface MarketplaceShipmentPayload {
  status: MarketplaceShipmentStatus;
  courier_name?: string;
  tracking_number?: string;
  note?: string;
  proof_url?: string;
}

export async function updateMarketplaceShipment(orderId: string, payload: MarketplaceShipmentPayload, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/${orderId}/shipment/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  return marketplaceOrderResponse(res, "Could not save the delivery update");
}

export interface MarketplaceReturnRequestPayload {
  kind: MarketplaceReturnKind;
  reason: MarketplaceReturnReason;
  description: string;
  evidence_urls?: string[];
  requested_amount_xaf?: string;
}

async function marketplaceOrderPost(orderId: string, path: string, body: object, accessToken: string, fallback: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/${orderId}/${path}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  return marketplaceOrderResponse(res, fallback);
}

export function requestMarketplaceReturn(orderId: string, payload: MarketplaceReturnRequestPayload, accessToken: string) {
  return marketplaceOrderPost(orderId, "return-request", payload, accessToken, "Could not send your request");
}

export function respondToMarketplaceReturn(orderId: string, decision: "ACCEPT" | "REJECT", note: string, accessToken: string) {
  return marketplaceOrderPost(orderId, "return-respond", { decision, note }, accessToken, "Could not send your answer");
}

export function withdrawMarketplaceReturn(orderId: string, accessToken: string) {
  return marketplaceOrderPost(orderId, "return-withdraw", {}, accessToken, "Could not withdraw the request");
}

export function escalateMarketplaceReturn(orderId: string, accessToken: string) {
  return marketplaceOrderPost(orderId, "return-escalate", {}, accessToken, "Could not send the request to support");
}

export function filenameFromContentDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]).trim() || fallback;
  } catch {
    return match[1].trim() || fallback;
  }
}

/** Fetches a file that needs the Authorization header and hands it to the browser as a download. */
async function downloadAuthenticatedFile(url: string, accessToken: string, fallbackName: string, fallbackError: string) {
  const res = await fetch(url, { headers: bearerHeaders(accessToken), cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || fallbackError);
  }
  const blob = await res.blob();
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filenameFromContentDisposition(res.headers.get("Content-Disposition"), fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function downloadMarketplaceReceipt(orderId: string, lang: string, accessToken: string) {
  return downloadAuthenticatedFile(
    `${API_BASE_URL}/api/marketplace-orders/${orderId}/receipt/?lang=${lang === "fr" ? "fr" : "en"}`,
    accessToken, `oaziland-receipt-${orderId}.pdf`, "Could not download the document",
  );
}

export type SellerPeriod = "7d" | "30d" | "90d" | "365d" | "all";

export interface SellerDashboard {
  period: SellerPeriod;
  since: string | null;
  summary: {
    orders_total: number;
    orders_completed: number;
    orders_cancelled: number;
    orders_open: number;
    items_sold: number;
    gross_sales_xaf: string;
    platform_fees_xaf: string;
    net_earnings_xaf: string;
    refunded_xaf: string;
    held_in_escrow_xaf: string;
    average_order_xaf: string;
    wallet_balance_xaf: string;
    listing_views: number;
    conversion_pct: number | null;
  };
  series: { bucket: "day" | "month"; points: { date: string; orders: number; gross_xaf: string; net_xaf: string }[] };
  by_category: { category: MarketplaceCategory; orders: number; gross_xaf: string; net_xaf: string }[];
  top_listings: { listing_id: string; title: string; category: MarketplaceCategory; orders: number; gross_xaf: string }[];
  returns: { open: number };
}

export interface SellerPayoutRow {
  order_id: string;
  listing_id: string;
  listing_title: string;
  buyer_name: string;
  quantity: number;
  paid_at: string;
  gross_xaf: string;
  fee_xaf: string;
  refunded_xaf: string;
  net_xaf: string;
}

export async function getSellerDashboard(period: SellerPeriod, accessToken: string): Promise<SellerDashboard> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-seller/dashboard/?period=${period}`, { headers: bearerHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error("Could not load your dashboard");
  return res.json();
}

export async function getSellerPayouts(
  period: SellerPeriod, page: number, accessToken: string,
): Promise<{ count: number; next: string | null; previous: string | null; results: SellerPayoutRow[] }> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-seller/payouts/?period=${period}&page=${page}`, { headers: bearerHeaders(accessToken), cache: "no-store" });
  if (!res.ok) throw new Error("Could not load your payouts");
  return res.json();
}

export function downloadSellerSalesCsv(period: SellerPeriod, accessToken: string) {
  return downloadAuthenticatedFile(
    `${API_BASE_URL}/api/marketplace-seller/sales.csv?period=${period}`,
    accessToken, `oaziland-sales-${period}.csv`, "Could not export your sales",
  );
}

export async function getMarketplaceListing<T>(category: MarketplaceCategory, id: string, accessToken?: string | null): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/`, { cache: "no-store", headers: bearerHeaders(accessToken) });
  if (!res.ok) throw new Error(`Not found: ${res.status}`);
  return res.json();
}

export type LuggageSize = "SMALL" | "MEDIUM" | "LARGE" | "BULKY";

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
  luggage_count: number | null;
  luggage_size: LuggageSize | "";
  luggage_photo_urls: string[];
  cargo_description: string;
  requested_at: string;
  completed_at: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: RideCancelReason | "";
  cancellation_note?: string;
  release_reason?: RideReleaseReason | "";
  release_note?: string;
  /** True while the request is being offered to nearby drivers one at a time. */
  matching?: boolean;
  /** The rider has started paying the fare and the provider has not confirmed it yet. */
  payment_pending?: boolean;
}

// ---------------------------------------------------------------------------
// My Bookings and real dispute-opening.
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
    // Shown for reference only: the server always prices the booking itself.
    amount_xaf: string | number;
    // How many price periods (months, semesters...) to pay for, where the target is priced per period.
    quantity?: number;
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

export async function getReservation(reservationId: string, accessToken: string): Promise<Reservation> {
  const res = await fetch(`${API_BASE_URL}/api/reservations/${reservationId}/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not check your reservation");
  return data;
}

export async function getBookingById(bookingId: string, accessToken: string): Promise<BookingItem> {
  const res = await fetch(`${API_BASE_URL}/api/bookings/${bookingId}/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not check your booking");
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

export interface EventBookingPayState extends EventBooking {
  venue_id: string;
  space_name: string;
  deposit_paid: boolean;
  balance_paid: boolean;
  is_organiser: boolean;
  is_owner: boolean;
  organiser_name: string;
  owner_payout_xaf: string | null;
  payment_held: boolean;
  payout_due_at: string | null;
  balance_due_at: string | null;
  cancellation: { free: boolean; free_until: string; fee_xaf: string; refund_xaf: string } | null;
}

export type EventActionName = "cancel" | "confirm-event" | "dispute" | "complete";

export async function eventBookingAction(id: string, action: EventActionName, accessToken: string, reason?: string): Promise<EventBookingPayState> {
  const res = await fetch(`${API_BASE_URL}/api/event-bookings/${id}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(action === "dispute" ? { reason } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "That action could not be completed");
  return data;
}

export async function listMyEventBookings(accessToken: string): Promise<EventBookingPayState[]> {
  return (await fetchEventBookings(accessToken)).filter((b) => b.is_organiser);
}

/** Bookings made at the venues the signed-in user owns. */
export async function listVenueBookings(accessToken: string): Promise<EventBookingPayState[]> {
  return (await fetchEventBookings(accessToken)).filter((b) => b.is_owner && !b.is_organiser);
}

async function fetchEventBookings(accessToken: string): Promise<EventBookingPayState[]> {
  const rows: EventBookingPayState[] = [];
  let url: string | null = `${API_BASE_URL}/api/event-bookings/`;
  for (let page = 0; url && page < 50; page += 1) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not load your venue bookings");
    if (Array.isArray(data)) return data;
    rows.push(...(data.results ?? []));
    url = data.next ?? null;
  }
  return rows;
}

export async function getEventBooking(id: string, accessToken: string): Promise<EventBookingPayState> {
  const res = await fetch(`${API_BASE_URL}/api/event-bookings/${id}/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not check your venue booking");
  return data;
}

/** Starts the Mobile Money payment of a venue booking's deposit or balance. `confirmed` is true when the money is
 * already held (sandbox); otherwise the provider confirms it after the payer approves on their phone. */
export async function payEventBooking(
  id: string, part: "deposit" | "balance", phoneNumber: string, accessToken: string
): Promise<{ confirmed: boolean; booking: EventBookingPayState }> {
  const res = await fetch(`${API_BASE_URL}/api/event-bookings/${id}/pay-${part}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "The payment could not be started");
  return { confirmed: res.status === 200, booking: data };
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
  fee_xaf: string;
  status: string;
  requested_at: string;
  resolved_at: string | null;
  phone_number: string;
  provider: string;
  rejection_reason: string;
}

export interface WalletDetail {
  balance_xaf: string;
  /** NONE | UNVERIFIED | PENDING | VERIFIED | REJECTED — only VERIFIED users can withdraw. */
  kyc_status: string;
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
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/rides/`, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new ApiStatusError("Could not fetch rides", 0);
  }
  if (!res.ok) throw new ApiStatusError("Could not fetch rides", res.status);
  return res.json();
}

export async function requestRide(
  payload: {
    pickup_description: string;
    dropoff_description: string;
    pickup_latitude: number;
    pickup_longitude: number;
    dropoff_latitude: number;
    dropoff_longitude: number;
    ride_category?: string;
    transport_type?: string;
    has_luggage?: boolean;
    luggage_count?: number | null;
    luggage_size?: LuggageSize | "";
    luggage_photo_urls?: string[];
    cargo_description?: string;
  },
  accessToken: string
) {
  const res = await fetch(`${API_BASE_URL}/api/rides/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new RideRequestError(data.detail || "Could not request ride", data.code);
  return data;
}

/** Why a ride request was refused when the server says so: a trip is already going, or an earlier fare is unpaid. */
export class RideRequestError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "RideRequestError";
    this.code = code;
  }
}

export interface RideQuote {
  distance_km: string;
  duration_minutes: number;
  /** Google encoded polyline of the road route; empty when estimated. */
  polyline: string;
  /** "estimate" = straight line ×1.3, used when Google's route service is unavailable. */
  source: "google" | "estimate";
  /** Fare in XAF per ride category, exactly as a booking would be charged. */
  fares: Record<string, string>;
}

/** Road distance, driving time and the fare for every vehicle category between two points, before booking. */
export async function quoteRide(
  points: { pickup_latitude: number; pickup_longitude: number; dropoff_latitude: number; dropoff_longitude: number },
  accessToken: string,
  signal?: AbortSignal,
): Promise<RideQuote> {
  const res = await fetch(`${API_BASE_URL}/api/rides/quote/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(points),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not work out the price");
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
  is_online?: boolean;
  last_seen_at?: string | null;
  vehicles: VehicleItem[];
}

export async function setDriverLocation(
  payload: { latitude?: number; longitude?: number; is_online?: boolean },
  accessToken: string,
): Promise<DriverProfileItem> {
  const res = await fetch(`${API_BASE_URL}/api/my-driver-profile/location/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not update your location");
  return data;
}

export type OpenRideItem = RideBookingItem & { pickup_distance_km: string | null };

export async function listOpenRides(
  accessToken: string,
  radiusKm?: number,
): Promise<{ count: number; driver_located: boolean; radius_km: number; results: OpenRideItem[] }> {
  const query = radiusKm ? `?radius_km=${radiusKm}` : "";
  const res = await fetch(`${API_BASE_URL}/api/rides/open/${query}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error("Could not load open requests");
  return res.json();
}

export interface RideOfferItem {
  ride: OpenRideItem;
  expires_at: string;
  seconds_left: number;
}

/** The ride currently offered to this driver (or null). Calling it also moves matching along on the server. */
export async function getMyRideOffer(accessToken: string): Promise<{ offer: RideOfferItem | null; offer_seconds: number }> {
  const res = await fetch(`${API_BASE_URL}/api/rides/my-offer/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error("Could not check for ride offers");
  return res.json();
}

export async function declineRideOffer(rideId: string, accessToken: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/decline/`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not decline the offer");
  return data;
}

export interface DriverTracking {
  located: boolean;
  latitude: string | null;
  longitude: string | null;
  updated_at: string | null;
  heading_to: "pickup" | "dropoff";
  distance_km: string | null;
  eta_minutes: number | null;
}

export async function getRideDriverLocation(rideId: string, accessToken: string): Promise<DriverTracking> {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/driver-location/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the driver's position");
  return res.json();
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

async function postRideAction(rideId: string, action: string, accessToken: string, body?: object) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/${action}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Action failed");
  return data;
}

export const RIDE_CANCEL_REASONS = [
  "CHANGED_PLANS", "WAITED_TOO_LONG", "DRIVER_ASKED_TO_CANCEL", "DRIVER_NOT_MOVING", "WRONG_PICKUP", "FOUND_OTHER_TRANSPORT", "OTHER",
] as const;
export const RIDE_RELEASE_REASONS = [
  "RIDER_UNREACHABLE", "PICKUP_TOO_FAR", "VEHICLE_PROBLEM", "LOAD_DOES_NOT_FIT", "SAFETY_CONCERN", "OTHER",
] as const;
// Set by the system, never chosen by a rider.
export const SYSTEM_RIDE_CANCEL_REASONS = ["NO_DRIVER_FOUND", "TRIP_NEVER_STARTED", "TRIP_ABANDONED"] as const;
export type RideCancelReason = (typeof RIDE_CANCEL_REASONS)[number] | (typeof SYSTEM_RIDE_CANCEL_REASONS)[number];
export type RideReleaseReason = (typeof RIDE_RELEASE_REASONS)[number];

export const cancelRide = (rideId: string, accessToken: string, reason?: { reason: RideCancelReason; note?: string }) =>
  postRideAction(rideId, "cancel", accessToken, reason);
export const releaseRide = (rideId: string, accessToken: string, reason?: { reason: RideReleaseReason; note?: string }) =>
  postRideAction(rideId, "release", accessToken, reason);

export interface EmergencyContact {
  name: string;
  phone: string;
  sms_delivery_live?: boolean;
}

export interface EmergencyContactState {
  contact: EmergencyContact | null;
  smsDeliveryLive: boolean;
}

export async function getMyEmergencyContact(accessToken: string): Promise<EmergencyContact | null> {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not load your emergency contact");
  return res.json();
}

export async function getMyEmergencyContactState(accessToken: string): Promise<EmergencyContactState> {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) {
    return { contact: null, smsDeliveryLive: data.sms_delivery_live !== false };
  }
  if (!res.ok) throw new Error("Could not load your emergency contact");
  return { contact: data, smsDeliveryLive: data.sms_delivery_live !== false };
}

export async function saveMyEmergencyContact(contact: EmergencyContact, accessToken: string): Promise<EmergencyContact> {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name: contact.name, phone: contact.phone }),
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

export interface SosEmergencyContactResult {
  name: string;
  phone: string;
  status: "sent" | "not_delivered" | "failed";
}

export async function raiseRideSos(
  rideId: string,
  accessToken: string,
  coords?: { latitude: number; longitude: number },
): Promise<{ sos_raised_at: string; admins_alerted: number; emergency_contact: SosEmergencyContactResult | null }> {
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
  id: number;
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

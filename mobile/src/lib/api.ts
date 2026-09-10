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

// ---------------------------------------------------------------------------
// Hospitality categories — mirrors the web app's real API shapes exactly.
// ---------------------------------------------------------------------------
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
  const res = await fetch(`${API_BASE_URL}/api/hotels/`);
  if (!res.ok) throw new Error(`Hotel search failed: ${res.status}`);
  return res.json();
}

export interface VenueSpaceSummary {
  id: string;
  space_name: string;
  capacity_theatre: number | null;
  capacity_banquet: number | null;
  base_price_per_hour_xaf: string;
}

export interface Venue {
  id: string;
  verified: boolean;
  quarter: string;
  quarter_name: string;
  spaces: VenueSpaceSummary[];
}

export async function searchVenues(): Promise<PaginatedResponse<Venue>> {
  const res = await fetch(`${API_BASE_URL}/api/venues/`);
  if (!res.ok) throw new Error(`Venue search failed: ${res.status}`);
  return res.json();
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
  property_type: string;
  quarter: string;
  quarter_name: string;
  units: HostelUnitSummary[];
}

export async function searchStudentHostels(): Promise<PaginatedResponse<StudentHostel>> {
  const res = await fetch(`${API_BASE_URL}/api/student-hostels/`);
  if (!res.ok) throw new Error(`Student hostel search failed: ${res.status}`);
  return res.json();
}

export interface GuestHouse {
  id: string;
  is_coastal_leisure: boolean;
  quarter: string;
  quarter_name: string;
  finish_level: string;
}

export async function searchGuestHouses(): Promise<PaginatedResponse<GuestHouse>> {
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/`);
  if (!res.ok) throw new Error(`Guest house search failed: ${res.status}`);
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
  const res = await fetch(`${API_BASE_URL}/api/wanted-listings/`);
  if (!res.ok) throw new Error(`Wanted-listing fetch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Notifications inbox — mirrors the web app's real notifications API.
// ---------------------------------------------------------------------------
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

export async function listMyNotifications(): Promise<PaginatedResponse<AppNotification>> {
  const res = await fetch(`${API_BASE_URL}/api/my-notifications/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch notifications");
  return res.json();
}

export async function markNotificationRead(id: string) {
  return fetch(`${API_BASE_URL}/api/my-notifications/${id}/mark_read/`, {
    method: "POST",
    headers: await authHeaders(),
  });
}

export async function markAllNotificationsRead() {
  return fetch(`${API_BASE_URL}/api/my-notifications/mark-all-read/`, {
    method: "POST",
    headers: await authHeaders(),
  });
}

// ---------------------------------------------------------------------------
// Saved Searches and Property Comparison — mirrors the web app's real APIs.
// ---------------------------------------------------------------------------
export interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, string>;
  last_notified_at: string | null;
}

export async function listSavedSearches(): Promise<PaginatedResponse<SavedSearch>> {
  const res = await fetch(`${API_BASE_URL}/api/saved-searches/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch saved searches");
  return res.json();
}

export async function createSavedSearch(name: string, filters: Record<string, string>) {
  const res = await fetch(`${API_BASE_URL}/api/saved-searches/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ name, filters }),
  });
  if (!res.ok) throw new Error("Could not create saved search");
  return res.json();
}

export async function deleteSavedSearch(id: string) {
  return fetch(`${API_BASE_URL}/api/saved-searches/${id}/`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
}

export interface PropertyComparisonData {
  id: string;
  listing_ids: string[];
  created_at: string;
}

export async function getMyComparison(): Promise<PropertyComparisonData | null> {
  const res = await fetch(`${API_BASE_URL}/api/my-comparison/`, { headers: await authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not fetch comparison");
  return res.json();
}

export async function setMyComparison(listingIds: string[]) {
  const res = await fetch(`${API_BASE_URL}/api/my-comparison/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ listing_ids: listingIds }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not update comparison");
  return res.json();
}

// ---------------------------------------------------------------------------
// Messaging inbox and typing indicators — mirrors the web app's real
// messaging API exactly.
// ---------------------------------------------------------------------------
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
  last_message: ConversationMessage | null;
  unread_count: number;
  created_at: string;
}

export async function listConversations(): Promise<PaginatedResponse<ConversationSummary>> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch conversations");
  return res.json();
}

export async function getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/messages/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch messages");
  return res.json();
}

export async function sendConversationMessage(conversationId: string, text: string): Promise<ConversationMessage> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/send/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ text, client_message_id: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}` }),
  });
  if (!res.ok) throw new Error("Could not send message");
  return res.json();
}

export async function markConversationSeen(conversationId: string) {
  return fetch(`${API_BASE_URL}/api/conversations/${conversationId}/mark_seen/`, {
    method: "POST",
    headers: await authHeaders(),
  });
}

export async function sendTypingHeartbeat(conversationId: string) {
  return fetch(`${API_BASE_URL}/api/conversations/${conversationId}/typing/`, {
    method: "POST",
    headers: await authHeaders(),
  });
}

export async function getTypingStatus(conversationId: string): Promise<{ typing_usernames: string[] }> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/typing-status/`, { headers: await authHeaders() });
  if (!res.ok) return { typing_usernames: [] };
  return res.json();
}

// ---------------------------------------------------------------------------
// Social feed — mirrors the web app's real feed API exactly.
// ---------------------------------------------------------------------------
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

export async function listFeedPosts(): Promise<PaginatedResponse<SocialPost>> {
  const res = await fetch(`${API_BASE_URL}/api/posts/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch feed");
  return res.json();
}

export async function listFollowingFeed(): Promise<PaginatedResponse<SocialPost>> {
  const res = await fetch(`${API_BASE_URL}/api/posts/following/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch following feed");
  return res.json();
}

export async function searchPosts(query: string): Promise<PaginatedResponse<SocialPost>> {
  const res = await fetch(`${API_BASE_URL}/api/posts/search/?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Could not search posts");
  return res.json();
}

export async function createPost(payload: { caption: string; tags?: string[]; linked_listing_id?: string; media_urls?: string[] }) {
  const res = await fetch(`${API_BASE_URL}/api/posts/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not create post");
  return data;
}

export async function reactToPost(postId: string, emoji: string) {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/react/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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

export async function addPostComment(postId: string, text: string) {
  const res = await fetch(`${API_BASE_URL}/api/comments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ post: postId, text }),
  });
  if (!res.ok) throw new Error("Could not add comment");
  return res.json();
}

// ---------------------------------------------------------------------------
// Admin console — mirrors the web app's real admin API exactly.
// ---------------------------------------------------------------------------
export interface AdminConsoleSummary {
  pending_verification_requests: number;
  open_content_reports: number;
  open_dispute_cases: number;
  reports_trend: { current_period_value: number; previous_period_value: number; percent_change: number | null };
}

export interface AdminVerificationRequest {
  id: string;
  requester: string;
  requester_name: string;
  request_type: string;
  status: string;
  supporting_document_url: string;
  submitted_at: string;
}

export interface AdminContentReport {
  id: string;
  reported_by: string;
  reported_by_name: string;
  reason: string;
  status: string;
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
}

export async function getAdminConsoleSummary(): Promise<AdminConsoleSummary> {
  const res = await fetch(`${API_BASE_URL}/api/admin/console-summary/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Admin summary fetch failed: ${res.status}`);
  return res.json();
}

export async function listAdminVerificationRequests(): Promise<PaginatedResponse<AdminVerificationRequest>> {
  const res = await fetch(`${API_BASE_URL}/api/admin/verification-requests/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Verification requests fetch failed: ${res.status}`);
  return res.json();
}

export async function approveVerificationRequest(id: string) {
  return fetch(`${API_BASE_URL}/api/admin/verification-requests/${id}/approve/`, { method: "POST", headers: await authHeaders() });
}

export async function rejectVerificationRequest(id: string, reason: string) {
  return fetch(`${API_BASE_URL}/api/admin/verification-requests/${id}/reject/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ reason }),
  });
}

export async function listAdminContentReports(): Promise<PaginatedResponse<AdminContentReport>> {
  const res = await fetch(`${API_BASE_URL}/api/admin/content-reports/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Content reports fetch failed: ${res.status}`);
  return res.json();
}

export async function resolveContentReport(id: string, actionTaken: string, issueStrike: boolean) {
  return fetch(`${API_BASE_URL}/api/admin/content-reports/${id}/resolve/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ action_taken: actionTaken, issue_strike: issueStrike }),
  });
}

export async function listAdminDisputeCases(): Promise<PaginatedResponse<AdminDisputeCase>> {
  const res = await fetch(`${API_BASE_URL}/api/admin/dispute-cases/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Dispute cases fetch failed: ${res.status}`);
  return res.json();
}

export async function respondToDispute(id: string) {
  return fetch(`${API_BASE_URL}/api/admin/dispute-cases/${id}/respond/`, { method: "POST", headers: await authHeaders() });
}

export async function resolveDispute(id: string, outcome: "RELEASE" | "REFUND", notes: string) {
  return fetch(`${API_BASE_URL}/api/admin/dispute-cases/${id}/resolve/`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ outcome, notes }),
  });
}

// ---------------------------------------------------------------------------
// Agent/Agency dashboard — mirrors the web app's real dashboard API.
// ---------------------------------------------------------------------------
export interface AgentDashboard {
  performance_score: number;
  open_enquiries: number;
  commission_trend_xaf: { current_period_value: string; previous_period_value: string; percent_change: number | null };
  is_agency_owner: boolean;
  agency_roster?: { user__username: string }[];
  agency_aggregated_commission_xaf?: string;
}

export async function getMyAgentDashboard(): Promise<AgentDashboard> {
  const res = await fetch(`${API_BASE_URL}/api/my-agent-dashboard/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Dashboard fetch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Real media upload — closes the gap found while auditing: on mobile,
// a photo taken in ListPropertyScreen was ONLY ever shown as a local
// preview and never actually uploaded or attached to anything.
// ---------------------------------------------------------------------------
export interface MediaUploadResult {
  url: string;
  media_type: "PHOTO" | "VIDEO";
}

export async function uploadMediaFile(uri: string, mimeType: string, folder: string): Promise<MediaUploadResult> {
  const filename = uri.split("/").pop() || "upload";
  const formData = new FormData();
  // React Native's fetch expects this exact {uri, name, type} shape
  // for a file field — not a real Blob/File object like the browser.
  formData.append("file", { uri, name: filename, type: mimeType } as unknown as Blob);
  formData.append("folder", folder);

  const headers = await authHeaders();
  const res = await fetch(`${API_BASE_URL}/api/media/upload/`, {
    method: "POST",
    headers, // Content-Type is deliberately omitted — fetch sets the
             // correct multipart boundary itself when given FormData;
             // setting it manually here would break the upload.
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Upload failed");
  return data;
}

export async function addListingPhoto(listingId: string, url: string, mediaType: "PHOTO" | "VIDEO") {
  const res = await fetch(`${API_BASE_URL}/api/listings/${listingId}/add-photo/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ url, media_type: mediaType }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not attach media");
  return res.json();
}

// ---------------------------------------------------------------------------
// Marketplace — warehouses, stores, businesses, cars, and real ride-
// hailing. Mobile parity with the web app's Marketplace, built this
// same session — mirrors the real backend API exactly.
// ---------------------------------------------------------------------------
export interface MarketplaceMediaItem {
  id: number;
  media_type: "PHOTO" | "VIDEO";
  file_url: string;
  order: number;
}

interface BaseMarketplaceListing {
  id: string;
  lister_name: string;
  lister_role: string;
  title: string;
  price_basis: string;
  price_xaf: string;
  quarter: string | null;
  quarter_name: string | null;
  media: MarketplaceMediaItem[];
}

export interface WarehouseListing extends BaseMarketplaceListing { size_sqm: string }
export interface StoreListing extends BaseMarketplaceListing { size_sqm: string; frontage_meters: string | null }
export interface BusinessListing extends BaseMarketplaceListing {
  includes_goodwill: boolean; includes_inventory: boolean; annual_revenue_xaf: string | null;
}
export interface VehicleSpec { make: string; model: string; year: number; mileage_km: number | null }
export interface CarListing extends BaseMarketplaceListing { vehicle_spec: VehicleSpec }

const MARKETPLACE_ENDPOINTS = { warehouses: "warehouses", stores: "stores", businesses: "businesses", cars: "cars" } as const;
export type MarketplaceCategory = keyof typeof MARKETPLACE_ENDPOINTS;

export async function listMarketplaceListings<T>(category: MarketplaceCategory): Promise<PaginatedResponse<T>> {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/`);
  if (!res.ok) throw new Error(`${category} fetch failed: ${res.status}`);
  return res.json();
}

export async function createMarketplaceListing(category: MarketplaceCategory, payload: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function addMarketplaceMedia(category: MarketplaceCategory, listingId: string, url: string, mediaType: "PHOTO" | "VIDEO") {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${listingId}/add-media/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ url, media_type: mediaType }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not attach media");
  return res.json();
}

export interface RideBookingItem {
  id: string;
  rider_name: string;
  driver_name: string | null;
  pickup_description: string;
  dropoff_description: string;
  fare_estimate_xaf: string;
  status: string;
}

export async function listMyRides(): Promise<PaginatedResponse<RideBookingItem>> {
  const res = await fetch(`${API_BASE_URL}/api/rides/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch rides");
  return res.json();
}

export async function requestRide(pickupDescription: string, dropoffDescription: string, distanceKm: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ pickup_description: pickupDescription, dropoff_description: dropoffDescription, distance_km: distanceKm }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not request ride");
  return data;
}

export async function acceptRide(rideId: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/accept/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not accept ride");
  return res.json();
}

export async function startRide(rideId: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/start/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not start ride");
  return res.json();
}

export async function completeRide(rideId: string, phoneNumber: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/complete/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not complete ride");
  return res.json();
}

// ---------------------------------------------------------------------------
// Taskln Service — real on-demand technician dispatch.
// ---------------------------------------------------------------------------
export interface ServiceRequestItem {
  id: string;
  requester_name: string;
  technician_name: string | null;
  category: string;
  priority: string;
  status: string;
  description: string;
}

export async function listMyServiceRequests(): Promise<PaginatedResponse<ServiceRequestItem>> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch service requests");
  return res.json();
}

export async function createServiceRequest(category: string, description: string, priority: string) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ category, description, priority }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not create service request");
  return data;
}

export async function acceptServiceRequest(id: string) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/accept/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not accept request");
  return res.json();
}

export async function startServiceRequest(id: string) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/start/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not start request");
  return res.json();
}

export async function completeServiceRequest(id: string, amountXaf: string, phoneNumber: string) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/complete/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ amount_xaf: amountXaf, phone_number: phoneNumber }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not complete request");
  return res.json();
}

// ---------------------------------------------------------------------------
// Real ratings and reporting a person directly — mobile parity with
// the web app's RateAndReport component, same session.
// ---------------------------------------------------------------------------
export async function rateUser(subjectUserId: string, score: number) {
  const res = await fetch(`${API_BASE_URL}/api/ratings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ subject_user: subjectUserId, score }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not submit rating");
  return data;
}

export async function fileReportAgainstUser(targetUserId: string, reason: string, notes: string) {
  const res = await fetch(`${API_BASE_URL}/api/content-reports/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ target_user: targetUserId, reason, notes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not submit report");
  return data;
}

// ---------------------------------------------------------------------------
// Property Management — mobile parity with the web app's
// /property-management page, same session.
// ---------------------------------------------------------------------------
export interface MaintenanceRequestItem {
  id: string;
  category: string;
  description: string;
  cost_estimate_xaf: string | null;
  status: string;
}

export async function listMaintenanceRequests(): Promise<PaginatedResponse<MaintenanceRequestItem>> {
  const res = await fetch(`${API_BASE_URL}/api/maintenance-requests/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch maintenance requests");
  return res.json();
}

export async function closeMaintenanceRequest(id: string) {
  const res = await fetch(`${API_BASE_URL}/api/maintenance-requests/${id}/close/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not close maintenance request");
  return res.json();
}

export interface TenantScreeningItem {
  id: string;
  prospective_tenant_name: string;
  status: string;
  report_summary: { completed_bookings: number; warning_count: number } | null;
}

export async function listTenantScreenings(): Promise<PaginatedResponse<TenantScreeningItem>> {
  const res = await fetch(`${API_BASE_URL}/api/tenant-screenings/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch tenant screenings");
  return res.json();
}

export async function consentToScreening(id: string) {
  const res = await fetch(`${API_BASE_URL}/api/tenant-screenings/${id}/consent/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not grant consent");
  return res.json();
}

export async function generateScreeningReport(id: string) {
  const res = await fetch(`${API_BASE_URL}/api/tenant-screenings/${id}/generate-report/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not generate report");
  return res.json();
}

export interface SafetyCheckInItem {
  id: string;
  emergency_contact_name: string;
  expected_checkout_at: string;
  status: string;
}

export async function listSafetyCheckIns(): Promise<PaginatedResponse<SafetyCheckInItem>> {
  const res = await fetch(`${API_BASE_URL}/api/safety-check-ins/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch safety check-ins");
  return res.json();
}

export async function startSafetyCheckIn(emergencyContactName: string, emergencyContactPhone: string, expectedDurationMinutes: number) {
  const res = await fetch(`${API_BASE_URL}/api/safety-check-ins/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ emergency_contact_name: emergencyContactName, emergency_contact_phone: emergencyContactPhone, expected_duration_minutes: expectedDurationMinutes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not start check-in");
  return data;
}

export async function checkOutSafely(id: string) {
  const res = await fetch(`${API_BASE_URL}/api/safety-check-ins/${id}/check-out/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not check out");
  return res.json();
}

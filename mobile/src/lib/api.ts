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
  next?: string | null;
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

export type SignupRole = "renter" | "landlord" | "agent" | "student" | "technician" | "driver";

export async function registerUser(payload: { username: string; phone: string; password: string; role?: SignupRole }) {
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
  house_style?: string;
  custom_house_style?: string;
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
// Real amenities, house rules, nearby facilities, and listing
// conditions — mobile parity with the web app's List a Property page,
// same session.
// ---------------------------------------------------------------------------
export async function setPropertyAmenities(propertyType: string, propertyId: string, amenities: string[]) {
  const endpoint = propertyType === "HOUSE" ? "houses" : propertyType.toLowerCase() + "s";
  const res = await fetch(`${API_BASE_URL}/api/${endpoint}/${propertyId}/set-amenities/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ amenities }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not set amenities");
  return res.json();
}

export async function setPropertyHouseRules(propertyId: string, houseRules: string[]) {
  const res = await fetch(`${API_BASE_URL}/api/houses/${propertyId}/set-house-rules/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ house_rules: houseRules }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not set house rules");
  return res.json();
}

export interface PointOfInterestItem {
  id: string;
  name: string;
  poi_type_display: string;
}

export async function listPointsOfInterest(quarterId: string): Promise<PointOfInterestItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/points-of-interest/?quarter=${quarterId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || data;
}

export async function setNearbyFacilities(propertyId: string, pointOfInterestIds: string[]) {
  const res = await fetch(`${API_BASE_URL}/api/houses/${propertyId}/set-nearby-facilities/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ point_of_interest_ids: pointOfInterestIds }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not set nearby facilities");
  return res.json();
}

export async function attachListingCondition(payload: { target_content_type: string; target_id: string; structured_conditions: Record<string, unknown>; free_text_clause: string }) {
  const res = await fetch(`${API_BASE_URL}/api/listing-conditions/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  // 204: posting empty conditions clears the listing's existing ones.
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const nested = Object.values(data.structured_conditions ?? {}).flat()[0];
    throw new Error(data.detail ?? (typeof nested === "string" ? nested : "Could not set listing conditions"));
  }
  return data;
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

// Unlike getListingConditions, a failed load throws, so an editor never mistakes "could not load" for "no conditions" and overwrites them.
export async function loadListingConditions(targetContentType: string, targetId: string): Promise<ListingConditionItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/listing-conditions/?target_content_type=${targetContentType}&target_id=${targetId}`);
  if (!res.ok) throw new Error("Could not load the listing's conditions");
  return res.json();
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

export async function getMyFavorites(): Promise<{ listing_ids: string[]; marketplace_listings: SavedMarketplaceListing[] }> {
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
  name?: string;
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

export async function getOrCreateConversation(participantId: string): Promise<ConversationSummary> {
  const res = await fetch(`${API_BASE_URL}/api/conversations/`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id: participantId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not open the conversation");
  return data;
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

async function fetchPostPage(path: string, page: number): Promise<PaginatedResponse<SocialPost>> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${API_BASE_URL}${path}${page > 1 ? `${separator}page=${page}` : ""}`;
  const headers = await authHeaders();
  let res = await fetch(url, { headers });
  // A dead session must not take down a public feed: retry as an anonymous visitor.
  if (res.status === 401 && headers.Authorization) res = await fetch(url);
  if (!res.ok) throw new Error("Could not load posts");
  const data = await res.json();
  return { count: data.count ?? 0, next: data.next ?? null, results: data.results ?? [] };
}

export function listFeedPosts(page = 1) {
  return fetchPostPage("/api/posts/", page);
}

export function listFollowingFeed(page = 1) {
  return fetchPostPage("/api/posts/following/", page);
}

export function listMyPosts(page = 1) {
  return fetchPostPage("/api/posts/mine/", page);
}

export function listTopicFeed(tag: string, page = 1) {
  return fetchPostPage(`/api/posts/topic/?tag=${encodeURIComponent(tag)}`, page);
}

export function searchPosts(query: string, page = 1) {
  return fetchPostPage(`/api/posts/search/?q=${encodeURIComponent(query)}`, page);
}

export type CreatePostErrorKind = "moderation" | "validation" | "network";

export class CreatePostError extends Error {
  kind: CreatePostErrorKind;
  constructor(message: string, kind: CreatePostErrorKind) {
    super(message);
    this.kind = kind;
  }
}

export async function createPost(payload: { caption: string; tags?: string[]; linked_listing_id?: string; media_urls?: string[] }) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/posts/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new CreatePostError("Could not reach the server", "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A `detail` on a 400 is the moderation gate; DRF field errors come back keyed by field instead.
    if (res.status === 400 && typeof data.detail === "string") throw new CreatePostError(data.detail, "moderation");
    const firstFieldError = Object.values(data).flat()[0];
    throw new CreatePostError(typeof firstFieldError === "string" ? firstFieldError : "Could not create post", "validation");
  }
  return data;
}

export async function deletePost(postId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not delete post");
}

export async function reactToPost(postId: string, emoji: string): Promise<SocialPost> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/react/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw new Error("Could not react to post");
  return res.json();
}

export async function removePostReaction(postId: string): Promise<SocialPost> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/remove-reaction/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not remove reaction");
  return res.json();
}

export type PostReportReason = "INAPPROPRIATE_CONTENT" | "SCAM_SUSPECTED" | "HARASSMENT" | "OTHER";

export async function reportPost(postId: string, reason: PostReportReason): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/content-reports/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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

export async function getPostComments(postId: string): Promise<PostComment[]> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/comments/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch comments");
  return res.json();
}

export async function addPostComment(postId: string, text: string): Promise<PostComment> {
  const res = await fetch(`${API_BASE_URL}/api/comments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ post: postId, text }),
  });
  if (!res.ok) throw new Error("Could not add comment");
  return res.json();
}

export async function deletePostComment(commentId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/comments/${commentId}/`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not delete comment");
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

export async function listAdminSosRides(): Promise<PaginatedResponse<AdminSosRide>> {
  const res = await fetch(`${API_BASE_URL}/api/admin/sos-rides/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`SOS rides fetch failed: ${res.status}`);
  return res.json();
}

export async function resolveAdminSosRide(rideId: string) {
  return fetch(`${API_BASE_URL}/api/admin/sos-rides/${rideId}/resolve/`, { method: "POST", headers: await authHeaders() });
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
  lister_user: string;
  lister_name: string;
  lister_role: string;
  title: string;
  description: string;
  price_basis: string;
  price_xaf: string;
  security_deposit_xaf: string;
  availability_status: string;
  quarter: string | null;
  quarter_name: string | null;
  media: MarketplaceMediaItem[];
}

export interface WarehouseListing extends BaseMarketplaceListing { size_sqm: string }
export interface StoreListing extends BaseMarketplaceListing { size_sqm: string; frontage_meters: string | null }
export interface BusinessListing extends BaseMarketplaceListing {
  includes_goodwill: boolean; includes_inventory: boolean; annual_revenue_xaf: string | null;
}
export interface VehicleSpec { make: string; model: string; year: number; mileage_km: number | null; engine_size_cc?: number | null }
export interface CarListing extends BaseMarketplaceListing { vehicle_spec: VehicleSpec }

const MARKETPLACE_ENDPOINTS = { warehouses: "warehouses", stores: "stores", businesses: "businesses", cars: "cars" } as const;
export type MarketplaceCategory = keyof typeof MARKETPLACE_ENDPOINTS;

export async function listMarketplaceListings<T>(category: MarketplaceCategory, filters?: Record<string, string>): Promise<PaginatedResponse<T>> {
  const query = filters && Object.keys(filters).length > 0 ? `?${new URLSearchParams(filters).toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${query}`);
  if (!res.ok) throw new Error(`${category} fetch failed: ${res.status}`);
  return res.json();
}

export async function getMarketplaceListing<T>(category: MarketplaceCategory, id: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Not found: ${res.status}`);
  return res.json();
}

export type MarketplaceOrderStatus = "PAYMENT_PENDING" | "PAID" | "HANDED_OVER" | "COMPLETED" | "CANCELLED" | "DISPUTED";

export type MarketplaceAvailability = "AVAILABLE" | "UNDER_OFFER" | "UNAVAILABLE";

export interface MyMarketplaceListing {
  id: string;
  title: string;
  description: string;
  price_xaf: string;
  price_basis: string;
  security_deposit_xaf: string;
  availability_status: MarketplaceAvailability;
  removed_by_moderation: boolean;
  size_sqm?: string | null;
  frontage_meters?: string | null;
  seating_capacity?: number | null;
  includes_goodwill?: boolean;
  includes_inventory?: boolean;
  annual_revenue_xaf?: string | null;
  vehicle_spec?: VehicleSpec;
}

// Everything the caller posted in one category, including sold or paused listings the public list hides.
// The API pages at 20, so keep fetching until every listing is in.
export async function listMyMarketplaceListings(category: MarketplaceCategory): Promise<MyMarketplaceListing[]> {
  const all: MyMarketplaceListing[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/mine/?page=${page}`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`Could not load your ${category}`);
    const data: PaginatedResponse<MyMarketplaceListing> = await res.json();
    all.push(...data.results);
    if (all.length >= data.count || data.results.length === 0) break;
  }
  return all;
}

async function marketplaceMutationError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => ({}));
  const firstFieldError = Object.values(data).flat()[0];
  return new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : fallback));
}

export async function updateMarketplaceListing(category: MarketplaceCategory, id: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not update the listing");
  return res.json();
}

export async function setMarketplaceListingStatus(category: MarketplaceCategory, id: string, status: MarketplaceAvailability) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/set-status/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not change the listing status");
  return res.json();
}

export async function deleteMarketplaceListing(category: MarketplaceCategory, id: string) {
  const res = await fetch(`${API_BASE_URL}/api/${MARKETPLACE_ENDPOINTS[category]}/${id}/`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not delete the listing");
}

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
}

async function marketplaceOrderResponse(res: Response, fallback: string): Promise<MarketplaceOrderItem> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : fallback));
  }
  return data;
}

export async function placeMarketplaceOrder(category: MarketplaceCategory, listingId: string, phoneNumber: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ category, listing_id: listingId, phone_number: phoneNumber }),
  });
  return marketplaceOrderResponse(res, "Could not place the order");
}

export async function listMyMarketplaceOrders(role: "buying" | "selling"): Promise<PaginatedResponse<MarketplaceOrderItem>> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/?role=${role}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not load your orders");
  return res.json();
}

export type MarketplaceOrderActionName = "hand-over" | "confirm" | "cancel" | "decline" | "dispute" | "return-deposit" | "claim-deposit";

export async function marketplaceOrderAction(orderId: string, action: MarketplaceOrderActionName, reason?: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/${orderId}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(action === "dispute" || action === "claim-deposit" ? { reason } : {}),
  });
  return marketplaceOrderResponse(res, "That action could not be completed");
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
  rider: string;
  rider_name: string;
  driver: string | null;
  driver_name: string | null;
  vehicle: number | null;
  vehicle_details: { vehicle_category: string; make: string; model: string; plate_number: string } | null;
  pickup_description: string;
  dropoff_description: string;
  fare_estimate_xaf: string;
  status: string;
  ride_category: string;
  transport_type: string;
  has_luggage: boolean;
  cargo_description: string;
}

export async function listMyRides(): Promise<PaginatedResponse<RideBookingItem>> {
  const res = await fetch(`${API_BASE_URL}/api/rides/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch rides");
  return res.json();
}

export async function requestRide(payload: {
  pickup_description: string; dropoff_description: string; distance_km: string;
  ride_category?: string; transport_type?: string; has_luggage?: boolean; cargo_description?: string;
}) {
  const res = await fetch(`${API_BASE_URL}/api/rides/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not request ride");
  return data;
}

export async function acceptRide(rideId: string, vehicleId: number) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/accept/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ vehicle_id: vehicleId }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not accept ride");
  return res.json();
}

// ---------------------------------------------------------------------------
// OaziGo — real driver and vehicle registration. Mobile parity with
// the web app's OaziGo page, same session.
// ---------------------------------------------------------------------------
export interface DriverProfileItem {
  id: number;
  license_number: string;
  is_verified: boolean;
}

export async function getMyDriverProfile(): Promise<DriverProfileItem | null> {
  const res = await fetch(`${API_BASE_URL}/api/my-driver-profile/`, { headers: await authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not fetch driver profile");
  return res.json();
}

export async function registerAsDriver(licenseNumber: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-driver-profile/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ license_number: licenseNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not register as a driver");
  return data;
}

export interface VehicleItem {
  id: number;
  vehicle_category: string;
  make: string;
  model: string;
  plate_number: string;
}

export async function listMyVehicles(): Promise<PaginatedResponse<VehicleItem>> {
  const res = await fetch(`${API_BASE_URL}/api/my-vehicles/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch vehicles");
  return res.json();
}

export async function registerVehicle(payload: { vehicle_category: string; make: string; model: string; plate_number: string }) {
  const res = await fetch(`${API_BASE_URL}/api/my-vehicles/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not register vehicle");
  return data;
}

export async function startRide(rideId: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/start/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json()).detail || "Could not start ride");
  return res.json();
}

export async function cancelRide(rideId: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/cancel/`, { method: "POST", headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not cancel the ride");
  return data;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  sms_delivery_live?: boolean;
}

export interface EmergencyContactState {
  contact: EmergencyContact | null;
  smsDeliveryLive: boolean;
}

export async function getMyEmergencyContact(): Promise<EmergencyContact | null> {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, { headers: await authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not load your emergency contact");
  return res.json();
}

export async function getMyEmergencyContactState(): Promise<EmergencyContactState> {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, { headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) {
    return { contact: null, smsDeliveryLive: data.sms_delivery_live !== false };
  }
  if (!res.ok) throw new Error("Could not load your emergency contact");
  return { contact: data, smsDeliveryLive: data.sms_delivery_live !== false };
}

export async function saveMyEmergencyContact(contact: EmergencyContact): Promise<EmergencyContact> {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ name: contact.name, phone: contact.phone }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Could not save the contact"));
  }
  return data;
}

export async function deleteMyEmergencyContact() {
  const res = await fetch(`${API_BASE_URL}/api/my-emergency-contact/`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not remove the contact");
}

export interface SosEmergencyContactResult {
  name: string;
  phone: string;
  status: "sent" | "not_delivered" | "failed";
}

export async function raiseRideSos(
  rideId: string,
  coords?: { latitude: number; longitude: number } | null,
): Promise<{ sos_raised_at: string; admins_alerted: number; emergency_contact: SosEmergencyContactResult | null }> {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/sos/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(coords ? { latitude: coords.latitude.toFixed(7), longitude: coords.longitude.toFixed(7) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not raise the SOS");
  return data;
}

export async function releaseRide(rideId: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/release/`, { method: "POST", headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not release the ride");
  return data;
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
  requester: string | null;
  requester_name: string;
  technician: string | null;
  technician_name: string | null;
  category: string;
  priority: string;
  status: string;
  description: string;
  quoted_amount_xaf: string | null;
  quoted_labor_xaf: string | null;
  quoted_materials_xaf: string | null;
  quote_approved: boolean;
  escrow_funded: boolean;
  dispute_reason: string;
  dispute_resolution: "" | "RESUME" | "REASSIGN" | "CANCEL";
  dispute_resolution_notes: string;
  scheduled_for: string | null;
  address_note?: string;
  area_label?: string;
  requested_technician?: string | null;
  requested_technician_name?: string | null;
  distance_km?: number | null;
  quote_deadline?: string | null;
  work_completed_at?: string | null;
  auto_release_at?: string | null;
  technician_overdue?: boolean;
  requester_rating?: { average: number | null; count: number };
  my_review?: { score: number; comment: string } | null;
  their_review?: { score: number; comment: string } | null;
  photos?: { id: number; photo_type: string; file_url: string }[];
}

export type ServiceRequestScope = "mine" | "jobs" | "board";

export async function listMyServiceRequests(
  options: { scope?: ServiceRequestScope; radiusKm?: string; page?: number } = {},
): Promise<PaginatedResponse<ServiceRequestItem> & { next: string | null }> {
  const params = new URLSearchParams();
  if (options.scope) params.set("scope", options.scope);
  if (options.radiusKm) params.set("radius_km", options.radiusKm);
  if (options.page && options.page > 1) params.set("page", String(options.page));
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${query}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch service requests");
  return res.json();
}

export async function createServiceRequest(
  category: string, description: string, priority: string, latitude: number | null, longitude: number | null,
  extras: { addressNote?: string; areaLabel?: string; photoUrls?: string[] } = {},
) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      category, description, priority,
      ...(latitude !== null && longitude !== null ? { latitude: latitude.toFixed(7), longitude: longitude.toFixed(7) } : {}),
      ...(extras.addressNote ? { address_note: extras.addressNote } : {}),
      ...(extras.areaLabel ? { area_label: extras.areaLabel } : {}),
      ...(extras.photoUrls && extras.photoUrls.length > 0 ? { photo_urls: extras.photoUrls } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Could not create service request"));
  }
  return data;
}

async function postServiceRequestAction(id: string, action: string, body: object = {}) {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : "Action failed"));
  }
  return data;
}

export const acceptServiceRequest = (id: string) => postServiceRequestAction(id, "accept");
export const startServiceRequest = (id: string) => postServiceRequestAction(id, "start");
export const releaseServiceRequest = (id: string) => postServiceRequestAction(id, "release");
export const markServiceRequestEnRoute = (id: string) => postServiceRequestAction(id, "en-route");
export const proposeServiceQuote = (id: string, laborXaf: string, materialsXaf?: string) =>
  postServiceRequestAction(id, "quote", { labor_xaf: laborXaf, ...(materialsXaf ? { materials_xaf: materialsXaf } : {}) });
export const rescheduleServiceRequest = (id: string, scheduledForIso: string) => postServiceRequestAction(id, "reschedule", { scheduled_for: scheduledForIso });
export const approveServiceQuote = (id: string) => postServiceRequestAction(id, "approve-quote");
export const disputeServiceRequest = (id: string, reason: string) => postServiceRequestAction(id, "dispute", { reason });
export const rateServiceTechnician = (id: string, score: number, comment = "") => postServiceRequestAction(id, "rate", { score, comment });
export const rateServiceRequester = (id: string, score: number, comment = "") => postServiceRequestAction(id, "rate-requester", { score, comment });
export const declineServiceRequest = (id: string) => postServiceRequestAction(id, "decline");
export const openServiceRequestToAll = (id: string) => postServiceRequestAction(id, "open-to-all");
export const rejectServiceQuote = (id: string) => postServiceRequestAction(id, "reject-quote");
export const dismissServiceTechnician = (id: string) => postServiceRequestAction(id, "dismiss-technician");
export const markServiceWorkDone = (id: string) => postServiceRequestAction(id, "work-done");
export const cancelServiceRequest = (id: string) => postServiceRequestAction(id, "cancel");

export async function submitTechnicianLocationPing(latitude: number, longitude: number) {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-location/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ latitude: latitude.toFixed(7), longitude: longitude.toFixed(7) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not share your location");
  return data;
}
export const completeServiceRequest = (id: string, phoneNumber?: string) => postServiceRequestAction(id, "complete", phoneNumber ? { phone_number: phoneNumber } : {});
export const fundServiceRequest = (id: string, phoneNumber: string) => postServiceRequestAction(id, "fund", { phone_number: phoneNumber });

export async function getMyUserId(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/auth/me/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not load your profile");
  return (await res.json()).id;
}

export interface ServiceReceipt {
  receipt_number: string;
  category: string;
  description: string;
  technician_name: string | null;
  labor_xaf: string | null;
  materials_xaf: string | null;
  total_xaf: string | null;
  platform_fee_xaf: string | null;
}

export async function getServiceReceipt(id: string): Promise<ServiceReceipt> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/receipt/`, { headers: await authHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not load the receipt");
  return data;
}

export interface ServiceRequestMessageItem {
  id: number;
  sender: string;
  sender_name: string;
  text: string;
}

export async function listServiceRequestMessages(id: string): Promise<ServiceRequestMessageItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/messages/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not load messages");
  return res.json();
}

export async function sendServiceRequestMessage(id: string, text: string): Promise<ServiceRequestMessageItem> {
  const res = await fetch(`${API_BASE_URL}/api/service-requests/${id}/messages/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not send the message");
  return data;
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

export async function fileReportAgainstListing(listingId: string, reason: string, notes: string) {
  const res = await fetch(`${API_BASE_URL}/api/content-reports/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ target_listing_id: listingId, reason, notes }),
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

// ---------------------------------------------------------------------------
// Agents and Agencies — mobile parity with the web app's directories.
// ---------------------------------------------------------------------------
export interface AgentDirectoryEntry {
  user_id: string;
  full_name: string;
  is_kyc_verified: boolean;
  average_rating: number | null;
  rating_count: number;
  active_listing_count: number;
  agency_name: string | null;
}

export async function listAgents(): Promise<PaginatedResponse<AgentDirectoryEntry>> {
  const res = await fetch(`${API_BASE_URL}/api/agents/`);
  if (!res.ok) throw new Error(`Agent directory fetch failed: ${res.status}`);
  return res.json();
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
  const res = await fetch(`${API_BASE_URL}/api/agents/${userId}/profile/`);
  if (!res.ok) throw new Error(`Agent profile fetch failed: ${res.status}`);
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

export async function listAgencies(): Promise<PaginatedResponse<AgencyDirectoryEntry>> {
  const res = await fetch(`${API_BASE_URL}/api/agencies/`);
  if (!res.ok) throw new Error(`Agency directory fetch failed: ${res.status}`);
  return res.json();
}

export async function getAgencyPublicProfile(agencyId: string): Promise<AgencyDirectoryEntry> {
  const res = await fetch(`${API_BASE_URL}/api/agencies/${agencyId}/profile/`);
  if (!res.ok) throw new Error(`Agency profile fetch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Careers — mobile parity with the web app's /careers page.
// ---------------------------------------------------------------------------
export interface JobPosting {
  id: string;
  posted_by_name: string;
  title: string;
  role_category: string;
  description: string;
  quarter_name: string | null;
  salary_min_xaf: string | null;
  salary_max_xaf: string | null;
}

export async function listJobPostings(): Promise<PaginatedResponse<JobPosting>> {
  const res = await fetch(`${API_BASE_URL}/api/jobs/`);
  if (!res.ok) throw new Error(`Job postings fetch failed: ${res.status}`);
  return res.json();
}

export async function applyToJob(jobId: string, coverMessage: string) {
  const res = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/apply/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ cover_message: coverMessage }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not submit application");
  return data;
}

// ---------------------------------------------------------------------------
// Testimonials — mobile parity with the web app's /testimonials page.
// ---------------------------------------------------------------------------
export interface Testimonial {
  author_name: string;
  score: number;
  text: string;
}

export async function listTestimonials(): Promise<PaginatedResponse<Testimonial>> {
  const res = await fetch(`${API_BASE_URL}/api/testimonials/`);
  if (!res.ok) throw new Error(`Testimonials fetch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Trainings — mobile parity with the web app's /trainings page.
// ---------------------------------------------------------------------------
export interface TrainingProgram {
  id: string;
  title: string;
  description: string;
  category: string;
  provider_name: string;
  price_xaf: string | null;
  issues_certification: boolean;
}

export async function listTrainings(): Promise<PaginatedResponse<TrainingProgram>> {
  const res = await fetch(`${API_BASE_URL}/api/trainings/`);
  if (!res.ok) throw new Error(`Training fetch failed: ${res.status}`);
  return res.json();
}

export async function enrollInTraining(programId: string) {
  const res = await fetch(`${API_BASE_URL}/api/trainings/${programId}/enroll/`, {
    method: "POST",
    headers: await authHeaders(),
  });
  return res;
}

// ---------------------------------------------------------------------------
// Services — mobile parity with the web app's /services partner
// directory page.
// ---------------------------------------------------------------------------
export interface ServiceOffering {
  id: string;
  name: string;
  description: string;
  price_hint_xaf: string | null;
}

export interface ServiceCategory {
  id: string;
  name: string;
  offerings: ServiceOffering[];
}

export async function listServiceCategories(): Promise<PaginatedResponse<ServiceCategory>> {
  const res = await fetch(`${API_BASE_URL}/api/service-categories/`);
  if (!res.ok) throw new Error(`Service catalogue fetch failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Creator Premium — mobile parity with the web app's /premium page.
// ---------------------------------------------------------------------------
export async function getMyCreatorPremiumStatus(): Promise<{ is_premium: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/my-creator-premium/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch premium status");
  return res.json();
}

export async function subscribeCreatorPremium(phoneNumber: string) {
  const res = await fetch(`${API_BASE_URL}/api/my-creator-premium/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Subscription failed");
  return data;
}

export async function cancelCreatorPremium() {
  const res = await fetch(`${API_BASE_URL}/api/my-creator-premium/`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not cancel");
  return res;
}

// ---------------------------------------------------------------------------
// Privacy Settings — mobile parity with the web app's
// /privacy-settings page.
// ---------------------------------------------------------------------------
export interface PresenceSettings {
  show_online_status: boolean;
  show_typing_indicator: boolean;
}

export async function getMyPresenceSettings(): Promise<PresenceSettings> {
  const res = await fetch(`${API_BASE_URL}/api/my-presence-settings/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch settings");
  return res.json();
}

export async function updateMyPresenceSettings(payload: Partial<PresenceSettings>) {
  const res = await fetch(`${API_BASE_URL}/api/my-presence-settings/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Could not update settings");
  return res.json();
}

// ---------------------------------------------------------------------------
// Referrals — mobile parity with the web app's /referrals page.
// ---------------------------------------------------------------------------
export async function getMyReferralCode(): Promise<{ referral_code: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/my-referral-code/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch referral code");
  return res.json();
}

// ---------------------------------------------------------------------------
// Technician Dashboard — mobile parity with the web app's
// /technician-dashboard page.
// ---------------------------------------------------------------------------
export interface TechnicianDashboardData {
  active_job_count: number;
  completed_job_count: number;
  wallet_balance_xaf: string;
  jobs_trend: { percent_change: number | null };
}

export interface TechnicianProfileItem {
  id: number;
  specialties: string[];
  is_verified: boolean;
  rejection_reason: string;
}

export async function getMyTechnicianProfile(): Promise<TechnicianProfileItem | null> {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-profile/`, { headers: await authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not fetch technician profile");
  return res.json();
}

export async function getMyTechnicianDashboard(): Promise<TechnicianDashboardData> {
  const res = await fetch(`${API_BASE_URL}/api/my-technician-dashboard/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch dashboard");
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

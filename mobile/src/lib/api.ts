/**
 * lib/api.ts — the mobile app's API client, mirroring the web app's
 * lib/api.ts (Prompt 17) exactly in shape, so both clients talk to the
 * SAME Django API (Prompt 16) identically. On a physical device this
 * points at the real deployed API URL; during local development it
 * points at the machine running the Django server on the local network
 * (not localhost, since a phone/emulator is a separate device).
 */
import * as SecureStore from "expo-secure-store";
import { imageSearchError } from "./marketplaceSearchAssist";

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
  lister_role: "OWNER" | "AGENT" | "AGENCY" | "PLATFORM";
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

export async function registerUser(payload: { username: string; phone: string; password: string; accept_terms: boolean; role?: SignupRole }) {
  const res = await fetch(`${API_BASE_URL}/api/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Field errors (a weak or taken password, a taken username) come back keyed by field, not as {detail}.
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
  const tokens = await res.json();
  // WHY SecureStore, not AsyncStorage: JWTs are credentials — SecureStore
  // uses the device's Keychain (iOS) / Keystore (Android) encrypted
  // storage, not plain-text storage AsyncStorage would use.
  await SecureStore.setItemAsync("access_token", tokens.access);
  await SecureStore.setItemAsync("refresh_token", tokens.refresh);
  return tokens;
}

export async function logout() {
  // Stop pushes to this phone before the sign-in is gone (removing the device needs it).
  const { unregisterDeviceForPush } = await import("./pushNotifications");
  await unregisterDeviceForPush().catch(() => {});
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
  category: BrowsableCategory;
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

/** A hotel or guest-house reservation as the guest or the host sees it. The rules (free cancellation until 48 hours
 * before check-in, the first night kept after that and for a no-show, automatic payout 24 hours after check-out
 * unless the guest reports a problem) are enforced by the server; the app only shows what is possible. */
export interface StayItem {
  id: string;
  guest_name: string;
  place_name: string;
  place_kind: "hotel" | "guest_house";
  place_id: string;
  room_type_name: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  rate_xaf: string;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED" | "NO_SHOW";
  payment_held: boolean;
  payout_due_at: string | null;
  cancellation: { free: boolean; free_until: string; fee_xaf: string; refund_xaf: string } | null;
}

export type StayActionName = "cancel" | "no-show" | "confirm-stay" | "dispute" | "check-in" | "checkout";

async function stayJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || fallback);
  return data as T;
}

/** Every reservation the user made (role "guest") or received at the places they own (role "host"), all pages. */
export async function listStays(role: "guest" | "host"): Promise<StayItem[]> {
  const rows: StayItem[] = [];
  let url: string | null = `${API_BASE_URL}/api/reservations/${role === "host" ? "?role=hosting" : ""}`;
  for (let page = 0; url && page < 50; page += 1) {
    const res: Response = await fetch(url, { headers: await authHeaders() });
    const data = await stayJson<PaginatedResponse<StayItem>>(res, "Could not load your stays");
    rows.push(...data.results);
    url = data.next ?? null;
  }
  return rows;
}

export async function stayAction(id: string, action: StayActionName, reason?: string): Promise<StayItem> {
  const res = await fetch(`${API_BASE_URL}/api/reservations/${id}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(action === "dispute" ? { reason } : {}),
  });
  return stayJson<StayItem>(res, "That could not be done");
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

/** A venue booking as the organiser or the venue's owner sees it. Money rules (free cancellation until 7 days
 * before, the deposit kept after that, the balance deadline, automatic payout 48 hours after the event) are
 * enforced by the server; this only displays them. */
export interface EventBookingItem {
  id: string;
  venue_space: string;
  venue_id: string;
  space_name: string;
  event_type: string;
  event_date: string;
  start_time: string;
  end_time: string;
  guest_count: number;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
  total_cost_xaf: string;
  deposit_amount_xaf: string;
  balance_amount_xaf: string;
  deposit_paid: boolean;
  balance_paid: boolean;
  is_organiser: boolean;
  is_owner: boolean;
  organiser_name: string;
  owner_payout_xaf: string | null;
  payment_held: boolean;
  payout_due_at: string | null;
  balance_due_at: string | null;
  cancellation: { free: boolean; free_until: string | null; fee_xaf: string; refund_xaf: string } | null;
}

export type EventBookingActionName = "cancel" | "confirm-event" | "dispute" | "complete";

async function eventBookingJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const firstFieldError = Object.values(data).flat()[0];
    throw new Error(data.detail || (typeof firstFieldError === "string" ? firstFieldError : fallback));
  }
  return data as T;
}

/** Every venue booking the signed-in user made (role "organiser") or received at their venues (role "owner"). */
export async function listEventBookings(role: "organiser" | "owner"): Promise<EventBookingItem[]> {
  const rows: EventBookingItem[] = [];
  let url: string | null = `${API_BASE_URL}/api/event-bookings/`;
  for (let page = 0; url && page < 50; page += 1) {
    const res: Response = await fetch(url, { headers: await authHeaders() });
    const data = await eventBookingJson<PaginatedResponse<EventBookingItem>>(res, "Could not load your venue bookings");
    rows.push(...data.results);
    url = data.next ?? null;
  }
  return rows.filter((b) => (role === "organiser" ? b.is_organiser : b.is_owner && !b.is_organiser));
}

export async function getEventBooking(id: string): Promise<EventBookingItem> {
  const res = await fetch(`${API_BASE_URL}/api/event-bookings/${id}/`, { headers: await authHeaders() });
  return eventBookingJson<EventBookingItem>(res, "Could not check your venue booking");
}

export async function createEventBooking(payload: {
  venue_space: string; event_type: string; event_date: string; start_time: string; end_time: string; guest_count: number;
}): Promise<EventBookingItem> {
  const res = await fetch(`${API_BASE_URL}/api/event-bookings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  return eventBookingJson<EventBookingItem>(res, "Could not book this venue");
}

/** Starts the Mobile Money payment. `confirmed` is true when the money is already held (sandbox); otherwise the
 * provider confirms it after the payer approves on their phone, so the caller checks the booking until it is. */
export async function payEventBooking(id: string, part: "deposit" | "balance", phoneNumber: string): Promise<{ confirmed: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/event-bookings/${id}/pay-${part}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  await eventBookingJson<EventBookingItem>(res, "The payment could not be started");
  return { confirmed: res.status === 200 };
}

export async function eventBookingAction(id: string, action: EventBookingActionName, reason?: string): Promise<EventBookingItem> {
  const res = await fetch(`${API_BASE_URL}/api/event-bookings/${id}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(action === "dispute" ? { reason } : {}),
  });
  return eventBookingJson<EventBookingItem>(res, "That action could not be completed");
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
/** What a notification is about, so a tap can open it: `null` when there is nothing to open. */
export interface NotificationTarget {
  kind: string;
  id?: string | number;
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

export async function createPost(payload: { caption: string; post_type?: "REEL"; tags?: string[]; linked_listing_id?: string; media_urls?: string[] }) {
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

export async function reportComment(commentId: string, reason: PostReportReason = "HARASSMENT"): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/content-reports/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ target_kind: "comment", target_id: String(commentId), reason }),
  });
  if (!res.ok) throw new Error("Could not file report");
}

// ---------------------------------------------------------------------------
// Videos — the full-screen, TikTok-style feed (the same /api/posts/reels/ API the web app uses).
// ---------------------------------------------------------------------------
export interface ReelListingPreview {
  id: string;
  listing_type: string;
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

export type ReelScope = "for_you" | "following" | "trending" | "saved";

export async function listReels(scope: ReelScope, page = 1, filters: { q?: string; tag?: string } = {}): Promise<PaginatedResponse<ReelPost>> {
  const params = new URLSearchParams({ scope });
  if (filters.q) params.set("q", filters.q);
  if (filters.tag) params.set("tag", filters.tag);
  if (page > 1) params.set("page", String(page));
  const url = `${API_BASE_URL}/api/posts/reels/?${params.toString()}`;
  const headers = await authHeaders();
  let res = await fetch(url, { headers });
  // A dead session must not take down a public feed: retry as an anonymous visitor.
  if (res.status === 401 && headers.Authorization) res = await fetch(url);
  if (!res.ok) throw new Error("Could not load videos");
  const data = await res.json();
  return { count: data.count ?? 0, next: data.next ?? null, results: data.results ?? [] };
}

export async function recordReelView(postId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/posts/${postId}/view/`, { method: "POST", headers: await authHeaders() }).catch(() => undefined);
}

export async function toggleSaveReel(postId: string): Promise<{ saved: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/save/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not save video");
  return res.json();
}

export async function recordReelShare(postId: string, channel: "WHATSAPP" | "IN_APP" = "IN_APP"): Promise<{ share_count: number }> {
  const res = await fetch(`${API_BASE_URL}/api/posts/${postId}/share/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ channel }),
  });
  if (!res.ok) throw new Error("Could not record share");
  return res.json();
}

export interface FollowStatus {
  is_following: boolean;
  follower_count: number;
  following_count: number;
}

export async function toggleFollow(userId: string): Promise<FollowStatus> {
  const res = await fetch(`${API_BASE_URL}/api/users/${userId}/follow/`, { method: "POST", headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not update follow status");
  return data;
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
  allow_offers: boolean;
  is_boosted: boolean;
  boosted_until: string | null;
  // Flash sales exist for goods only, but every category now carries the same fields.
  sale_price_xaf?: string | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  on_sale?: boolean;
  current_price_xaf?: string;
  seller_on_vacation?: boolean;
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
/** Goods (new and used items) can be browsed, bought and posted in the app. */
export type BrowsableCategory = MarketplaceCategory | "goods";
const BROWSE_ENDPOINTS: Record<BrowsableCategory, string> = { ...MARKETPLACE_ENDPOINTS, goods: "goods" };

/** One purchasable version of a goods listing ("Red / M"), with its own stock and final unit price. */
export interface GoodsVariant {
  id: string;
  label: string;
  options: Record<string, string>;
  sku: string;
  price_xaf: string;
  price_delta_xaf: string;
  quantity: number;
  available: boolean;
  photo_url: string | null;
  is_active: boolean;
}

export interface GoodsListing extends BaseMarketplaceListing {
  /** A display-only "was" price, always above price_xaf. */
  compare_at_price_xaf: string | null;
  has_variants: boolean;
  /** The lowest price among versions in stock. */
  price_from_xaf: string | null;
  variants: GoodsVariant[];
  item_category: string;
  condition: string;
  quantity: number;
  pickup_available: boolean;
  seller_delivery: boolean;
  seller_delivery_fee_xaf: string | null;
  seller_delivery_areas: string;
  courier_shipping: boolean;
  courier_fee_xaf: string | null;
  courier_note: string;
}

export async function listMarketplaceListings<T>(category: BrowsableCategory, filters?: Record<string, string>): Promise<PaginatedResponse<T>> {
  const query = filters && Object.keys(filters).length > 0 ? `?${new URLSearchParams(filters).toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/${query}`);
  if (!res.ok) throw new Error(`${category} fetch failed: ${res.status}`);
  return res.json();
}

/** One row of the cross-category feed: the listing as its category serialises it, plus which category it is. */
export type MarketplaceFeedListing = BaseMarketplaceListing & Partial<GoodsListing> & { category: BrowsableCategory };

/** Every category in one list: `on_sale=1&ordering=ending_soon` for flash deals, `lister_id` for one shop. */
export async function listMarketplaceFeed(filters: Record<string, string>): Promise<PaginatedResponse<MarketplaceFeedListing>> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-feed/?${new URLSearchParams(filters).toString()}`);
  if (!res.ok) throw new Error(`Could not load the marketplace: ${res.status}`);
  return res.json();
}

export async function getMarketplaceListing<T>(category: BrowsableCategory, id: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/${id}/`, { headers: await authHeaders() });
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
  quantity?: number;
  compare_at_price_xaf?: string | null;
  has_variants?: boolean;
  expires_at?: string;
  is_expired?: boolean;
  is_boosted?: boolean;
  boosted_until?: string | null;
  sale_price_xaf?: string | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  on_sale?: boolean;
  stats?: MarketplaceListingStats;
}

/** Views, saves and chats on one of the caller's own listings. */
export interface MarketplaceListingStats {
  views: number;
  saves: number;
  chats: number;
}

// Everything the caller posted in one category, including sold or paused listings the public list hides.
// The API pages at 20, so keep fetching until every listing is in.
export async function listMyMarketplaceListings(category: BrowsableCategory): Promise<MyMarketplaceListing[]> {
  const all: MyMarketplaceListing[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/mine/?page=${page}`, { headers: await authHeaders() });
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

export async function updateMarketplaceListing(category: BrowsableCategory, id: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not update the listing");
  return res.json();
}

export async function setMarketplaceListingStatus(category: BrowsableCategory, id: string, status: MarketplaceAvailability) {
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/${id}/set-status/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not change the listing status");
  return res.json();
}

export async function deleteMarketplaceListing(category: BrowsableCategory, id: string) {
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/${id}/`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not delete the listing");
}

/** One row of the set sent to replace a goods listing's versions: no id means a new version. */
export interface GoodsVariantInput {
  id?: string;
  options: Record<string, string>;
  price_delta_xaf: number;
  quantity: number;
  sku?: string;
  photo_url?: string;
  is_active?: boolean;
}

export interface GoodsVariantServerError {
  index?: number;
  field: string;
  message: string;
}

/** The versions of one of the caller's goods listings, including hidden ones. */
export async function getGoodsVariants(listingId: string): Promise<GoodsVariant[]> {
  const res = await fetch(`${API_BASE_URL}/api/goods/${listingId}/variants/`, { headers: await authHeaders() });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not load the options");
  return (await res.json()).variants;
}

/** Replaces the whole set; a rejected row comes back on the thrown error's `errors` (see variantServerErrors). */
export async function saveGoodsVariants(listingId: string, variants: GoodsVariantInput[]): Promise<{ variants: GoodsVariant[]; quantity: number }> {
  const res = await fetch(`${API_BASE_URL}/api/goods/${listingId}/variants/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ variants }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(typeof data.detail === "string" ? data.detail : "Could not save the options"), {
      errors: Array.isArray(data.errors) ? (data.errors as GoodsVariantServerError[]) : [],
    });
  }
  return data;
}

/** The per-row problems the server reported when saving options (empty for any other error). */
export function variantServerErrors(error: unknown): GoodsVariantServerError[] {
  const errors = (error as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) ? (errors as GoodsVariantServerError[]) : [];
}

/** Puts a listing back on the marketplace for another listing lifetime ("Still available"). */
export async function renewMarketplaceListing(category: BrowsableCategory, id: string): Promise<{ id: string; expires_at: string; is_expired: boolean }> {
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/${id}/renew/`, { method: "POST", headers: await authHeaders() });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not renew the listing");
  return res.json();
}

export type BoostUnit = "DAILY" | "MONTHLY";
export type BoostPayWith = "WALLET" | "MOMO";

export interface BoostOption {
  duration_unit: BoostUnit;
  unit_price_xaf: string;
  max_quantity: number;
}

export async function getMarketplaceBoostOptions(): Promise<BoostOption[]> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-boost-options/`);
  if (!res.ok) throw new Error("Could not load the boost prices");
  return (await res.json()).options;
}

export async function boostMarketplaceListing(
  category: BrowsableCategory, id: string,
  purchase: { duration_unit: BoostUnit; quantity: number; pay_with: BoostPayWith; phone_number: string },
): Promise<{ id: string; boosted_until: string; price_xaf: string }> {
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/${id}/boost/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(purchase),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not boost the listing");
  return res.json();
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
  reply_rate_pct: number | null;
  reply_time_hours: number | null;
  last_seen_at: string | null;
}

export async function getMarketplaceSeller(userId: string): Promise<MarketplaceSellerSummary> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-sellers/${userId}/`);
  if (!res.ok) throw new Error("Could not load the seller");
  return res.json();
}

export type MarketplaceOfferStatus = "PENDING" | "COUNTERED" | "ACCEPTED" | "PAID" | "DECLINED" | "WITHDRAWN" | "EXPIRED";

export interface MarketplaceOffer {
  id: string;
  listing_id: string;
  listing_title: string;
  listing_price_xaf: string;
  price_basis: string;
  category: BrowsableCategory | "";
  photo_url: string | null;
  buyer: string;
  buyer_name: string;
  seller: string;
  seller_name: string;
  amount_xaf: string;
  counter_amount_xaf: string | null;
  agreed_amount_xaf: string | null;
  message: string;
  status: MarketplaceOfferStatus;
  created_at: string;
  responded_at: string | null;
  accepted_at: string | null;
  pay_by: string | null;
  respond_by: string | null;
}

export async function makeMarketplaceOffer(category: BrowsableCategory, listingId: string, amountXaf: number, message?: string): Promise<MarketplaceOffer> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-offers/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ category, listing_id: listingId, amount_xaf: amountXaf, ...(message ? { message } : {}) }),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not send your offer");
  return res.json();
}

export async function listMyMarketplaceOffers(role: "buying" | "selling", listingId?: string): Promise<PaginatedResponse<MarketplaceOffer>> {
  const query = new URLSearchParams({ role, ...(listingId ? { listing_id: listingId } : {}) });
  const res = await fetch(`${API_BASE_URL}/api/marketplace-offers/?${query.toString()}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not load your offers");
  return res.json();
}

export type MarketplaceOfferActionName = "accept" | "decline" | "counter" | "withdraw";

export async function marketplaceOfferAction(offerId: string, action: MarketplaceOfferActionName, amountXaf?: number): Promise<MarketplaceOffer> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-offers/${offerId}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(action === "counter" ? { amount_xaf: amountXaf } : {}),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "That action could not be completed");
  return res.json();
}

export interface MarketplaceOrderItem {
  id: string;
  listing_id: string;
  listing_title: string;
  category: BrowsableCategory | "";
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
  can_review: boolean;
  my_review: { score: number; text: string; created_at: string } | null;
  quantity: number;
  delivery_method: MarketplaceDeliveryMethod;
  delivery_fee_xaf: string;
  delivery_address: string;
  price_breakdown: Record<string, unknown> | null;
  courier_name: string;
  tracking_number: string;
  shipment_status: ShipmentStatus;
  shipped_at: string | null;
  delivered_at: string | null;
  delivery_proof_url: string;
  delivery_note: string;
  shipment_events: ShipmentEvent[];
  is_tracked: boolean;
  receipt_available: boolean;
  return_request: ReturnRequest | null;
  can_request_return: boolean;
  discount_xaf?: string;
  coupon_code?: string;
  checkout?: string | null;
  /** "Red / M" for an item with options, otherwise an empty string. */
  variant_label: string;
}

export type MarketplaceDeliveryMethod = "PICKUP" | "SELLER" | "COURIER" | "";
export type ShipmentStatus = "" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED";
export type ShipmentStep = Exclude<ShipmentStatus, "">;

export interface ShipmentEvent {
  status: ShipmentStep | "REPLACEMENT";
  note: string;
  at: string;
}

export type ReturnKind = "REFUND" | "PARTIAL_REFUND" | "REPLACEMENT";
export type ReturnReason = "NOT_AS_DESCRIBED" | "DAMAGED" | "WRONG_ITEM" | "MISSING_PARTS" | "NOT_WORKING" | "OTHER";
export type ReturnStatus = "REQUESTED" | "ACCEPTED" | "REJECTED" | "ESCALATED" | "WITHDRAWN" | "CLOSED";

export interface ReturnRequest {
  id: string;
  kind: ReturnKind;
  reason: ReturnReason;
  description: string;
  evidence_urls: string[];
  requested_amount_xaf: string | null;
  status: ReturnStatus;
  seller_note: string;
  created_at: string;
  responded_at: string | null;
  respond_by: string | null;
  buyer_decide_by: string | null;
}

export interface MarketplaceReview {
  id: string | number;
  author_name: string;
  score: number;
  text: string;
  created_at: string;
  verified_purchase: boolean;
}

export interface MarketplaceReviewSummary {
  average: number | null;
  count: number;
  distribution: Record<string, number>;
  results: MarketplaceReview[];
}

export async function getMarketplaceListingReviews(category: BrowsableCategory, id: string): Promise<MarketplaceReviewSummary> {
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/${id}/reviews/`);
  if (!res.ok) throw new Error("Could not load the reviews");
  return res.json();
}

export async function reviewMarketplaceOrder(orderId: string, score: number, text?: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/${orderId}/review/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ score, ...(text ? { text } : {}) }),
  });
  return marketplaceOrderResponse(res, "Could not publish your review");
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
  category: BrowsableCategory, listingId: string, phoneNumber: string,
  goods?: { quantity: number; delivery_method?: "PICKUP" | "SELLER" | "COURIER"; delivery_address?: string; variant_id?: string },
  offerId?: string,
  options?: { couponCode?: string },
) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      category, listing_id: listingId, phone_number: phoneNumber, ...goods,
      ...(offerId ? { offer_id: offerId } : {}), ...(options?.couponCode ? { coupon_code: options.couponCode } : {}),
    }),
  });
  return marketplaceOrderResponse(res, "Could not place the order");
}

// ---------------------------------------------------------------------------
// Cart: goods from one seller are paid with ONE Mobile Money payment and then split into one order per item.
// ---------------------------------------------------------------------------
export interface CartItem {
  listing_id: string;
  /** Set for items with options: the same listing can appear once per version. */
  variant_id: string | null;
  variant_label: string;
  title: string;
  photo_url: string | null;
  unit_price_xaf: string;
  list_price_xaf: string;
  compare_at_price_xaf?: string | null;
  on_sale: boolean;
  sale_ends_at: string | null;
  quantity: number;
  stock: number;
  available: boolean;
  reason: string;
  line_total_xaf: string;
}

export interface CartDeliveryOption {
  method: "PICKUP" | "SELLER" | "COURIER";
  fee_xaf: string;
}

export interface CartGroup {
  seller_id: string;
  seller_name: string;
  subtotal_xaf: string;
  can_checkout: boolean;
  delivery_options: CartDeliveryOption[];
  items: CartItem[];
}

export interface MarketplaceCart {
  item_count: number;
  groups: CartGroup[];
}

export interface CartQuoteRequest {
  seller_id: string;
  delivery_method: CartDeliveryOption["method"];
  delivery_address?: string;
  coupon_code?: string;
}

export interface CartQuote {
  subtotal_xaf: string;
  discount_xaf: string;
  delivery_fee_xaf: string;
  total_xaf: string;
  delivery_method: CartDeliveryOption["method"];
  coupon_error: string | null;
}

export interface CartCheckoutResult {
  checkout_id: string;
  total_xaf: string;
  orders: MarketplaceOrderItem[];
}

async function cartRequest<T>(path: string, method: "GET" | "POST" | "DELETE", fallback: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-cart/${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(await authHeaders()) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await marketplaceMutationError(res, fallback);
  return res.json();
}

export const getMarketplaceCart = () => cartRequest<MarketplaceCart>("", "GET", "Could not load your cart");
export const setCartItem = (listingId: string, quantity: number, variantId?: string | null) =>
  cartRequest<MarketplaceCart>("items/", "POST", "Could not update your cart", {
    listing_id: listingId, quantity, ...(variantId ? { variant_id: variantId } : {}),
  });
export const removeCartItem = (listingId: string, variantId?: string | null) =>
  cartRequest<MarketplaceCart>(
    `items/${listingId}/${variantId ? `?variant_id=${encodeURIComponent(variantId)}` : ""}`, "DELETE", "Could not remove the item",
  );
export const quoteMarketplaceCart = (request: CartQuoteRequest) =>
  cartRequest<CartQuote>("quote/", "POST", "Could not work out the total", request);
export const checkoutMarketplaceCart = (request: CartQuoteRequest & { phone_number: string }) =>
  cartRequest<CartCheckoutResult>("checkout/", "POST", "Could not start the payment", request);

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------
export type CouponKind = "PERCENT" | "FIXED";

export interface MarketplaceCoupon {
  id: string;
  code: string;
  kind: CouponKind;
  value: string | number;
  min_order_xaf: string | number;
  max_uses: number | null;
  uses: number;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
}

export interface CouponCheck {
  valid: boolean;
  message: string;
  discount_xaf: string;
  code: string;
}

export async function checkMarketplaceCoupon(listingId: string, quantity: number, code: string): Promise<CouponCheck> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupon-check/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ listing_id: listingId, quantity, code }),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not check the coupon");
  return res.json();
}

export async function listMyCoupons(): Promise<MarketplaceCoupon[]> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupons/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not load your coupons");
  const data = await res.json();
  return Array.isArray(data) ? data : data.results;
}

export async function createMyCoupon(payload: Record<string, unknown>): Promise<MarketplaceCoupon> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupons/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not create the coupon");
  return res.json();
}

export async function updateMyCoupon(id: string, payload: Record<string, unknown>): Promise<MarketplaceCoupon> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupons/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not update the coupon");
  return res.json();
}

export async function deleteMyCoupon(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-coupons/${id}/`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not delete the coupon");
}

// ---------------------------------------------------------------------------
// Shop storefront
// ---------------------------------------------------------------------------
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

export async function getMarketplaceShop(userId: string): Promise<MarketplaceShop> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-shops/${userId}/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(res.status === 404 ? "This shop could not be found." : "Could not load the shop.");
  return res.json();
}

export async function getMyShopSettings(): Promise<MarketplaceShopSettings> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-shop/me/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not load your shop settings");
  return res.json();
}

export async function saveMyShopSettings(payload: Record<string, unknown>): Promise<MarketplaceShopSettings> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-shop/me/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await marketplaceMutationError(res, "Could not save your shop");
  return res.json();
}

// ---------------------------------------------------------------------------
// Search assist: spelling suggestion, trending searches and search by photo. Synonyms and spelling are applied
// by the server to the normal q search, so these only drive the UI around it.
// ---------------------------------------------------------------------------
export interface SearchAssist {
  query: string;
  did_you_mean: string | null;
  synonyms: string[];
}

export async function getMarketplaceSearchAssist(q: string): Promise<SearchAssist> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-search/assist/?${new URLSearchParams({ q }).toString()}`);
  if (!res.ok) throw new Error("Search suggestions are unavailable");
  return res.json();
}

export async function getTrendingMarketplaceSearches(days = 7): Promise<{ term: string; count: number }[]> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-search/trending/?days=${days}`);
  if (!res.ok) throw new Error("Trending searches are unavailable");
  return (await res.json()).results;
}

export async function searchMarketplaceByImage(uri: string, mimeType: string): Promise<{ keywords: string[]; q: string }> {
  const formData = new FormData();
  formData.append("image", { uri, name: uri.split("/").pop() || "search.jpg", type: mimeType } as unknown as Blob);
  const res = await fetch(`${API_BASE_URL}/api/marketplace-search/image/`, { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(imageSearchError(res.status, typeof data.detail === "string" ? data.detail : undefined));
  return data;
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

export interface ShipmentUpdate {
  status: ShipmentStep;
  courier_name?: string;
  tracking_number?: string;
  note?: string;
  proof_url?: string;
}

export async function updateMarketplaceShipment(orderId: string, update: ShipmentUpdate) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/${orderId}/shipment/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(update),
  });
  return marketplaceOrderResponse(res, "Could not update the delivery");
}

export interface ReturnRequestPayload {
  kind: ReturnKind;
  reason: ReturnReason;
  description: string;
  evidence_urls?: string[];
  requested_amount_xaf?: number;
}

async function postReturnAction(orderId: string, action: string, body: object, fallback: string) {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-orders/${orderId}/${action}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  return marketplaceOrderResponse(res, fallback);
}

export const requestMarketplaceReturn = (orderId: string, payload: ReturnRequestPayload) =>
  postReturnAction(orderId, "return-request", payload, "Could not send your return request");
export const respondMarketplaceReturn = (orderId: string, decision: "ACCEPT" | "REJECT", note: string) =>
  postReturnAction(orderId, "return-respond", { decision, note }, "Could not send your answer");
export const withdrawMarketplaceReturn = (orderId: string) =>
  postReturnAction(orderId, "return-withdraw", {}, "Could not withdraw the request");
export const escalateMarketplaceReturn = (orderId: string) =>
  postReturnAction(orderId, "return-escalate", {}, "Could not send the request to support");

export type SellerPeriod = "7d" | "30d" | "90d" | "365d" | "all";

export interface SellerDashboardSummary {
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
}

export interface SellerSeriesPoint { date: string; orders: number; gross_xaf: string; net_xaf: string }
export interface SellerCategoryRow { category: BrowsableCategory; orders: number; gross_xaf: string; net_xaf: string }
export interface SellerTopListing { listing_id: string; title: string; category: BrowsableCategory; orders: number; gross_xaf: string }

export interface SellerDashboard {
  period: SellerPeriod;
  since: string | null;
  summary: SellerDashboardSummary;
  series: { bucket: "day" | "month"; points: SellerSeriesPoint[] };
  by_category: SellerCategoryRow[];
  top_listings: SellerTopListing[];
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

export async function getSellerDashboard(period: SellerPeriod): Promise<SellerDashboard> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-seller/dashboard/?period=${period}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not load your sales dashboard");
  return res.json();
}

export async function listSellerPayouts(period: SellerPeriod, page = 1): Promise<PaginatedResponse<SellerPayoutRow>> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-seller/payouts/?period=${period}&page=${page}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not load your payouts");
  return res.json();
}

export async function fetchSellerSalesCsv(period: SellerPeriod): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/marketplace-seller/sales.csv?period=${period}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not export your sales");
  return res.text();
}

export async function createMarketplaceListing(category: BrowsableCategory, payload: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function addMarketplaceMedia(category: BrowsableCategory, listingId: string, url: string, mediaType: "PHOTO" | "VIDEO") {
  const res = await fetch(`${API_BASE_URL}/api/${BROWSE_ENDPOINTS[category]}/${listingId}/add-media/`, {
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
  distance_km?: string | null;
  requested_at?: string;
  cancellation_reason?: RideCancelReason | "";
  cancellation_note?: string;
  release_reason?: RideReleaseReason | "";
  release_note?: string;
}

export const RIDE_CANCEL_REASONS = [
  "CHANGED_PLANS", "WAITED_TOO_LONG", "DRIVER_ASKED_TO_CANCEL", "DRIVER_NOT_MOVING", "WRONG_PICKUP", "FOUND_OTHER_TRANSPORT", "OTHER",
] as const;
export const RIDE_RELEASE_REASONS = [
  "RIDER_UNREACHABLE", "PICKUP_TOO_FAR", "VEHICLE_PROBLEM", "LOAD_DOES_NOT_FIT", "SAFETY_CONCERN", "OTHER",
] as const;
// NO_DRIVER_FOUND is set by the server when a request expires; riders can't pick it.
export type RideCancelReason = (typeof RIDE_CANCEL_REASONS)[number] | "NO_DRIVER_FOUND";
export type RideReleaseReason = (typeof RIDE_RELEASE_REASONS)[number];
// Display labels for these codes live in src/i18n/messages.ts (cancelReason.*, releaseReason.*, issue.*).

export const RIDE_ISSUE_CATEGORIES = [
  "FARE", "ROUTE", "DRIVER_BEHAVIOUR", "RIDER_BEHAVIOUR", "VEHICLE", "LOST_ITEM", "DAMAGE", "OTHER",
] as const;
export type RideIssueCategory = (typeof RIDE_ISSUE_CATEGORIES)[number];
// Mirrors RIDE_ISSUE_WINDOW_DAYS on the server.
export const RIDE_ISSUE_WINDOW_DAYS = 14;

/** Whether this person can report a problem on this trip: a driver has taken it, they're on it, and it's recent. */
export function canReportRideIssue(ride: RideBookingItem, userId: string | null, now = Date.now()): boolean {
  if (!userId || ride.status === "REQUESTED") return false;
  if (userId !== ride.rider && userId !== ride.driver) return false;
  if (!ride.requested_at) return true;
  return now - new Date(ride.requested_at).getTime() < RIDE_ISSUE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Sends a trip problem report to the Oaziland team, who reply by notification. */
export async function reportRideIssue(rideId: string, payload: { category: RideIssueCategory; description: string }) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/report-issue/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.description?.[0] || "Could not send your report");
  return data;
}

/** Earnings from the rides a user DROVE. /api/rides/ also returns rides they booked as a rider, which aren't earnings. */
export function driverEarnings(rides: RideBookingItem[], driverId: string | null) {
  const driven = driverId ? rides.filter((r) => r.driver === driverId) : [];
  const completed = driven.filter((r) => r.status === "COMPLETED");
  return {
    completedTrips: completed.length,
    activeTrips: driven.filter((r) => r.status === "ACCEPTED" || r.status === "IN_PROGRESS").length,
    grossXaf: completed.reduce((sum, r) => sum + Number(r.fare_estimate_xaf || 0), 0),
  };
}

export async function listMyRides(): Promise<PaginatedResponse<RideBookingItem>> {
  const res = await fetch(`${API_BASE_URL}/api/rides/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not fetch rides");
  return res.json();
}

export async function requestRide(payload: {
  pickup_description: string; dropoff_description: string;
  pickup_latitude: number; pickup_longitude: number; dropoff_latitude: number; dropoff_longitude: number;
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

export interface RidePoints {
  pickup_latitude: number;
  pickup_longitude: number;
  dropoff_latitude: number;
  dropoff_longitude: number;
}

export interface RideQuote {
  distance_km: string;
  duration_minutes: number;
  polyline: string;
  /** "estimate" = straight line ×1.3, used when Google's route service is unavailable. */
  source: "google" | "estimate";
  /** Fare in XAF per ride category, exactly as a booking would be charged. */
  fares: Record<string, string>;
}

/** Road distance, driving time and the fare for every vehicle category between two points, before booking. */
export async function quoteRide(points: RidePoints, signal?: AbortSignal): Promise<RideQuote> {
  const res = await fetch(`${API_BASE_URL}/api/rides/quote/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(points),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not work out the price");
  return data;
}

export interface PlaceSuggestion {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}

/** Places in Cameroon matching the text (OpenStreetMap search, the same one the website uses). */
export async function searchPlaces(query: string, language: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=cm&limit=5&q=${encodeURIComponent(query)}`;
  // OpenStreetMap's usage policy asks apps to identify themselves.
  const res = await fetch(url, { signal, headers: { "Accept-Language": language, "User-Agent": "Oaziland mobile app (support@oaziland.com)" } });
  if (!res.ok) return [];
  const rows: { place_id: number; display_name: string; lat: string; lon: string }[] = await res.json();
  return rows.map((row) => ({
    id: String(row.place_id),
    label: row.display_name.split(", ").slice(0, 3).join(", "),
    latitude: Number(Number(row.lat).toFixed(6)),
    longitude: Number(Number(row.lon).toFixed(6)),
  }));
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
  is_online?: boolean;
  last_seen_at?: string | null;
}

/** A verified driver reports their position and/or goes online or offline. */
export async function setDriverLocation(payload: { latitude?: number; longitude?: number; is_online?: boolean }): Promise<DriverProfileItem> {
  const res = await fetch(`${API_BASE_URL}/api/my-driver-profile/location/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not update your location");
  return data;
}

export interface RideOfferItem {
  ride: RideBookingItem & { pickup_distance_km: string | null };
  expires_at: string;
  seconds_left: number;
}

/** The ride automatic matching is offering this driver right now (or null). Checking also moves matching along on the server. */
export async function getMyRideOffer(): Promise<{ offer: RideOfferItem | null; offer_seconds: number }> {
  const res = await fetch(`${API_BASE_URL}/api/rides/my-offer/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not check for ride offers");
  return res.json();
}

export async function declineRideOffer(rideId: string) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/decline/`, { method: "POST", headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not decline the offer");
  return data;
}

/** The driver's vehicles that can do this ride: cargo needs a van or truck, passengers the exact category asked for. */
export function vehiclesForRide<V extends { vehicle_category: string }>(vehicles: V[], ride: { transport_type: string; ride_category: string }): V[] {
  return vehicles.filter((v) =>
    ride.transport_type === "CARGO" ? v.vehicle_category === "VAN" || v.vehicle_category === "TRUCK" : v.vehicle_category === ride.ride_category,
  );
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

export async function cancelRide(rideId: string, reason?: { reason: RideCancelReason; note?: string }) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/cancel/`, {
    method: "POST",
    headers: { ...(await authHeaders()), ...(reason ? { "Content-Type": "application/json" } : {}) },
    body: reason ? JSON.stringify(reason) : undefined,
  });
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

export async function releaseRide(rideId: string, reason?: { reason: RideReleaseReason; note?: string }) {
  const res = await fetch(`${API_BASE_URL}/api/rides/${rideId}/release/`, {
    method: "POST",
    headers: { ...(await authHeaders()), ...(reason ? { "Content-Type": "application/json" } : {}) },
    body: reason ? JSON.stringify(reason) : undefined,
  });
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
export async function getRatingEligibility(subjectUserId: string): Promise<{ can_rate: boolean; reason: string }> {
  const res = await fetch(`${API_BASE_URL}/api/ratings/?subject_user=${encodeURIComponent(subjectUserId)}`, {
    headers: { ...(await authHeaders()) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not check rating eligibility");
  return data;
}

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

export interface WalletWithdrawal {
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
  transactions: { id: string; transaction_type: string; amount_xaf: string; related_reference: string; created_at: string }[];
  withdrawals: WalletWithdrawal[];
}

export type PayoutProvider = "MTN_MOMO" | "ORANGE_MONEY";

export async function getMyWallet(): Promise<WalletDetail> {
  const res = await fetch(`${API_BASE_URL}/api/wallet/`, { headers: await authHeaders() });
  if (!res.ok) throw new Error("Could not load your wallet");
  return res.json();
}

/** Asks for a Mobile Money payout; an admin reviews each request before it's paid. */
export async function withdrawWallet(payload: { amount_xaf: number; phone_number: string; provider: PayoutProvider }) {
  const res = await fetch(`${API_BASE_URL}/api/wallet/withdraw/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Withdrawal failed");
  return data as { detail: string; withdrawal_id: string; amount_xaf: string; status: string; balance_xaf: string };
}

export type WithdrawalBlocker = "kycPending" | "kycRejected" | "kycMissing" | "noAmount" | "overBalance";

/** Why a payout can't be requested yet (shown as the "wallet.block.*" message), or null when it can. */
export function withdrawalBlocker(wallet: Pick<WalletDetail, "balance_xaf" | "kyc_status">, amount: number): WithdrawalBlocker | null {
  if (wallet.kyc_status === "PENDING") return "kycPending";
  if (wallet.kyc_status === "REJECTED") return "kycRejected";
  if (wallet.kyc_status !== "VERIFIED") return "kycMissing";
  if (!amount || amount <= 0) return "noAmount";
  if (amount > Number(wallet.balance_xaf)) return "overBalance";
  return null;
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

export type KycSubmission = Omit<KycProfile, "kyc_status" | "submitted_at" | "reviewed_at">;

/** The user's identity verification, or null when they haven't submitted one yet. */
export async function getMyKycStatus(): Promise<KycProfile | null> {
  const res = await fetch(`${API_BASE_URL}/api/auth/kyc/`, { headers: await authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not load your verification status");
  return res.json();
}

export async function submitKyc(payload: KycSubmission): Promise<KycProfile> {
  const res = await fetch(`${API_BASE_URL}/api/auth/kyc/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // DRF field errors come back as { field: ["message"] }; show the first one.
    const firstFieldError = Object.values(data).find((v) => Array.isArray(v)) as string[] | undefined;
    throw new Error(data.detail || firstFieldError?.[0] || "Could not submit your verification");
  }
  return data;
}

/** The fields still missing before a KYC submission can be sent, in the order the form asks for them
 * (shown with the "kyc.missing.*" messages). */
export function kycMissing(form: KycSubmission): (keyof KycSubmission)[] {
  const missing: (keyof KycSubmission)[] = [];
  if (!form.legal_full_name.trim()) missing.push("legal_full_name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date_of_birth) || Number.isNaN(Date.parse(form.date_of_birth))) missing.push("date_of_birth");
  if (!form.national_id_number.trim()) missing.push("national_id_number");
  if (!form.residential_address.trim()) missing.push("residential_address");
  if (!form.id_document_front_image_url) missing.push("id_document_front_image_url");
  if (!form.id_document_back_image_url) missing.push("id_document_back_image_url");
  if (!form.selfie_image_url) missing.push("selfie_image_url");
  return missing;
}

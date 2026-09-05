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
  description: string;
}

export interface Listing {
  id: string;
  property_asset: PropertyAssetSummary;
  listing_type: string;
  status: string;
  price_xaf: string;
  published_at: string | null;
  created_at: string;
  lister_role: "OWNER" | "AGENT" | "AGENCY";
  lister_display_name: string;
  lister_agency_name: string | null;
  lister_id: string;
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
}

/** Searches listings — the exact endpoint Prompt 16 built and tested. */
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
  const res = await fetch(`${API_BASE_URL}/api/venues/`, { cache: "no-store" });
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
  const res = await fetch(`${API_BASE_URL}/api/student-hostels/`, { cache: "no-store" });
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
  const res = await fetch(`${API_BASE_URL}/api/guest-houses/`, { cache: "no-store" });
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
  const res = await fetch(`${API_BASE_URL}/api/wanted-listings/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Wanted-listing fetch failed: ${res.status}`);
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
  const res = await fetch(`${API_BASE_URL}/api/agents/${userId}/profile/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Agent profile fetch failed: ${res.status}`);
  return res.json();
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

export async function getMyEnrollments(accessToken: string): Promise<{ count: number; results: { program: string }[] }> {
  const res = await fetch(`${API_BASE_URL}/api/my-enrollments/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not fetch enrollments");
  return res.json();
}

export async function getMyReferralCode(accessToken: string): Promise<{ referral_code: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/my-referral-code/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Could not fetch referral code");
  return res.json();
}

export interface AgentDashboard {
  performance_score: number;
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
  subject_content_type: string;
  subject_id: string;
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

export async function getMyFavorites(accessToken: string): Promise<{ listing_ids: string[] }> {
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
  payload: { caption: string; tags?: string[]; linked_listing_id?: string },
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

export async function registerUser(payload: {
  username: string;
  phone: string;
  password: string;
  referral_code?: string;
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

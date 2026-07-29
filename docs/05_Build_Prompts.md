# Oaziland — Complete Build Prompts (Execution-Ready, Start to Finish)

**Who this is for:** you — a founder with no programming background — handing off execution to a developer, an agency, or an AI coding tool (e.g. Claude Code). Every prompt below is written to be copy-pasted and executed as-is, with the exact fields, features, and third-party services needed for that specific piece of work — not a vague description of what to build.

---

## How to Use This Document

1. **Paste Prompt 0 at the start of every single work session.** No exceptions — it's what keeps the code consistent, commented, and OOP-structured throughout.
2. **Attach the four prior design documents every session:**
   - `Oaziland_Architecture_Data_Model.md`
   - `Oaziland_Pre_Development_Design.md`
   - `Oaziland_UML_Data_Model_Specification.docx`
   - `Oaziland_Technology_Stack_Deployment_Roadmap.docx`
3. **Work the prompts in order** — each one lists exactly which APIs/subscriptions it needs, at the moment they're needed, not all at once up front.
4. **Use the "Acceptance Criteria" under each prompt** to verify completion yourself, without reading code.
5. Prompts marked **✅ Foundation Already Built** extend real, working code produced earlier in this project — don't rebuild from zero.
6. **Appendix A** (at the end) is the master API/subscription list with every cost in one place, for budgeting.

---

## PROMPT 0 — Master Context & Standing Rules (paste every session)

```
You are building "Oaziland," a real estate super-app for Cameroon and
Africa — web app + mobile app, one shared backend and one shared
PostgreSQL database. I am the founder. I am not a programmer, have never
built software, and am new to IT — explain what you're doing in plain
language at every step, and never assume I understand a technical term
without a one-line explanation.

STANDING RULES — apply to every file, every session, without exception:

1. OBJECT-ORIENTED PROGRAMMING: model every real-world thing (a User, a
   Property, a Booking, a Payment, an Ad Campaign) as a class with a
   single clear responsibility. Use inheritance only where a genuine
   "is-a" relationship exists (e.g. House is-a PropertyAsset); use
   composition/attached objects everywhere else (e.g. a User HAS-A
   Role, not IS-A Role). Follow the class structures in the UML
   specification exactly — do not invent a different structure.

2. COMMENTS: every class gets a comment explaining what real-world thing
   it represents and why it exists. Every non-obvious method or business
   rule (fee calculations, the 7-minute booking lock, commission splits)
   gets a comment explaining WHY, not just what the code does. Write for
   a reader who has never seen this project before.

3. NO SILENT SCOPE CREEP: build exactly what the current prompt asks for.
   If you think a later prompt's work should happen now, ask me first
   instead of doing it silently.

4. NO GUESSING ON AMBIGUITY: if the design documents don't clearly answer
   a question this prompt raises, stop and ask me rather than picking an
   answer yourself.

5. END-OF-PROMPT REPORT: after finishing, tell me: (a) exactly what you
   built, in plain language, (b) how I can verify it worked WITHOUT
   reading any code, (c) which third-party accounts/API keys I now need
   to create and why, and (d) anything you were unsure about.

6. SECURITY BASICS, ALWAYS: never hardcode API keys, passwords, or
   secrets directly in code — use environment variables. Never log
   sensitive data (passwords, ID numbers, payment details) in plain
   text. Validate and sanitize every piece of user input.

Confirm you have understood these six rules before we begin any work.
```

---

## PROMPT 1 — Development Environment & Project Infrastructure

```
Set up the complete development environment and project skeleton before
any feature code is written.

TASKS:
1. Initialize a Git repository with this folder structure:
   /backend  (Django project)
   /web      (Next.js project)
   /mobile   (React Native/Expo project)
   /docs     (the design documents I've provided)
2. Set up a Python virtual environment and install Django, Django REST
   Framework, psycopg2 (PostgreSQL driver), django-environ (for
   environment variables), and pytest-django (for testing).
3. Create a `.env.example` file listing every environment variable the
   project will need (database URL, secret key, and placeholders for
   every API key we'll add in later prompts) — WITHOUT real values.
4. Set up a local PostgreSQL database (with the PostGIS extension
   enabled) for development.
5. Initialize a GitHub (or GitLab) repository and connect it, with a
   `.gitignore` that excludes `.env`, `__pycache__`, `node_modules`, and
   any file containing secrets.
6. Set up a basic CI pipeline (GitHub Actions) that runs automated tests
   on every code change.

REQUIRED ACCOUNTS/SUBSCRIPTIONS FOR THIS PROMPT:
- GitHub or GitLab account — Free
- Local PostgreSQL installation — Free (no signup; installed on the
  developer's machine or in a Docker container)

ACCEPTANCE CRITERIA (how you'll know it's done):
- Ask to see the repository on GitHub with the folder structure above.
- Ask the developer to run the test command and show you a message
  saying tests ran successfully (even with zero tests written yet, it
  should say "0 tests ran, no errors" rather than failing).
```

---

## PROMPT 2 — Identity, Roles, Authentication, MFA & KYC ✅ Foundation Already Built (Auth/MFA/KYC extension needed)

```
Extend the existing `identity` app (which already has a working User
model and Role profiles) with full authentication, multi-factor security,
and mandatory KYC data collection.

DETAILED REQUIREMENTS:

User model (already exists) — confirm it has: id, full_name, phone
(unique, primary contact), email (optional, unique), password_hash,
verification_status (Unverified/Pending/Verified/Rejected),
preferred_language (EN/FR), country (foreign key), created_at,
deleted_at (soft delete).

Role profiles (already exist) — confirm LandlordProfile, AgentProfile
(with a link to an optional AgencyProfile and a commission_rate),
AgencyProfile (registration_number, commission_policy),
StudentProfile (institution_name), TechnicianProfile (specialties list,
average_rating), AdminProfile (permissions list) all exist and a single
User can hold several simultaneously.

NEW — OAuthAccount: links a User to a Google or Facebook account
(provider, provider_user_id, linked_at). If someone signs up with Google
using the same email/phone as an existing normal account, link to the
SAME account — never create a duplicate.

NEW — MfaMethod: type (SMS OTP / Authenticator App / Email OTP),
destination (phone or email), is_primary, verified. A user must set up
at least one MFA method before they can list a property or make a
payment (read-only browsing does not require MFA).

NEW — MfaChallenge: the actual one-time code sent, with an expiry time
and a "consumed" flag so a code can't be reused.

NEW — KYCProfile: mandatory one-to-one with every User. Fields:
legal_full_name, date_of_birth, national_id_number, id_document_image,
selfie_image, residential_address, kyc_status
(Unverified/Pending/Verified/Rejected). Registration cannot complete
without this being at least submitted (status can start as Pending).

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- Google Cloud Console (OAuth 2.0 credentials for "Sign in with
  Google") — Free, needs a Google account and a few minutes of setup
- Meta for Developers (Facebook Login credentials) — Free, needs a
  Facebook Business account
- SMS OTP provider — recommended: Africa's Talking (strong Cameroon/
  Africa coverage) or Twilio Verify — both are pay-per-message,
  typically $0.01–0.05 per SMS, no fixed monthly fee at low volume
- Authenticator-app codes (TOTP) need NO external API — use the free
  `pyotp` Python library
- Smile Identity (KYC document verification: OCR + facial match against
  Cameroonian national ID) — usage-based, priced per verification
  (confirm current rate directly with Smile Identity; typically in the
  $0.50–2.00 per verification range for African ID verification
  services)

ACCEPTANCE CRITERIA:
- Ask to create a test account using a real Google account and confirm
  you land in the app logged in.
- Ask to see the MFA setup screen and successfully receive and enter a
  real SMS code on a test phone number.
- Ask to see a test KYC submission with a photo ID and confirm its
  status shows "Pending" until manually approved in the admin site.
```

---

## PROMPT 3 — Geography & Location Services ✅ Foundation Already Built

```
Confirm and extend the existing `geo` app.

DETAILED REQUIREMENTS:
- Country, Region, Division, Subdivision, VillageOrDistrict, Quarter —
  full nested hierarchy already exists; confirm it is NOT hardcoded to
  Cameroon only (any country should be addable later).
- QuarterPriceTrend — already exists; confirm it stores average price
  per square meter per quarter, computed periodically, not manually
  entered.
- NEW — add a generic "PointOfInterest" model (name, type: university/
  hospital/market/transport_hub, quarter, latitude, longitude) so
  "distance to nearest university" (for student housing) and "distance
  to nearest market" work through ONE reusable pattern, not a special
  case per amenity type.
- NEW — a distance-calculation service that computes straight-line and
  (where available) road-network distance from any PropertyAsset to the
  nearest PointOfInterest of a given type, and to the nearest tarred
  road.

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- OpenStreetMap (Nominatim for geocoding, Overpass API for points of
  interest) — Free, no account required for reasonable usage, but
  self-host or use a rate-limited public instance respectfully
- Google Maps Platform (optional, upgrade later for satellite/Street
  View polish) — requires a Google Cloud Billing account; includes a
  recurring monthly free credit, then pay-per-use (Places API,
  Geocoding API, Maps JavaScript API each billed separately)

ACCEPTANCE CRITERIA:
- Ask to see a test property in Bastos, Yaoundé show a real calculated
  distance to the nearest tarred road and nearest university.
```

---

## PROMPT 4 — Property & Land: Full 15-Category Taxonomy ✅ Foundation Already Built

```
Confirm and extend the existing `property` and `land` apps to cover the
complete Cameroon property taxonomy.

DETAILED REQUIREMENTS — confirm all of these exist with the specific
fields listed:

Residential:
- RoomUnit: room_code (unique per building), internal_bathroom (bool),
  kitchen_access (enum: veranda/shared_corridor/none)
- StudioUnit: room_code, kitchen_type (enum: open_american_style/
  partitioned)
- ApartmentUnit: room_code, bedrooms, bathrooms, separate_salon (bool)
- House: house_style (standard/duplex/detached_villa),
  is_furnished_short_let (bool), short_let_daily_rate
- Building: contains many Units; has a bulk_create_units(count,
  template) method so a landlord can create 40 identical rooms in one
  action, each auto-assigned a unique room_code

Commercial & Hospitality:
- Shop (frontage_meters), CorporateOffice, EventCenter (venue spaces),
  GuestHouseLodge (is_coastal_leisure), MixedUseBuilding
  (ground_floor_shops count)

Land & Infrastructure:
- Land: land_use_type (titled_residential/commercial_plot/agricultural/
  car_wash_paved_plot), title_deed_number, title_type (Titre Foncier/
  Concession/Demande en Cours), boundary_polygon (GeoJSON), bornes_
  visibles (bool, corner markers confirmed)
- Warehouse (storage_capacity_sqm)

Land Trust Layer (land app):
- SecureDocument (title deed, location plan, owner ID — admin-only
  visibility)
- CornerPhoto (4 corner photos per land parcel)
- VerificationBadge (badge_type: verified_document/site_visit_verified/
  bornes_visibles/title_type/identity_kyc; status; verified_by;
  verified_at)
- ScamFlag (reported_by, reason, status)
- LandInquiry (the "I Am Looking For Land" reverse board: buyer, target
  quarter, budget, notes)

Cameroon Market Fields (attach to every Listing):
- CameroonMarketDetails: legal_status, rent_advance_months,
  caution_deposit, agency_visit_fee, agency_commission_percent,
  water_source (Camwater/Forage/Puits), electricity_meter_type
  (Eneo Prepaid/Postpaid), road_accessibility (tarred/car_accessible/
  moto_only)
- SecurityFeatures: fenced_gate, secured_openings_antivols,
  guard_status (none/night_watchman/24_7), parking_spaces

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- None new — this prompt is pure data-modeling on top of the existing
  database.

ACCEPTANCE CRITERIA:
- Ask to see, in the admin site, one example of each of the 15 property
  categories, each showing the fields specific to it.
- Ask to see a landlord bulk-create 10 identical rooms in one action and
  confirm each got a different room_code automatically.
```

---

## PROMPT 5 — Transactions: Bookings, Escrow, Contracts & Payments ✅ Foundation Already Built

```
Confirm and extend the existing `transactions` app.

DETAILED REQUIREMENTS — confirm these exist:
- Booking: booking_type (land_reservation/hotel/event/hostel_semester/
  guest_house/general_rental), status (pending/payment_processing/
  payment_failed/confirmed/checked_in/completed/cancelled/refunding/
  expired), amount, currency, idempotency_key (prevents duplicate
  bookings from a retried request), hold_expires_at
- PaymentEscrow: gross_amount, platform_fee, payee_amount, status
  (held/released/refunded/disputed), provider, provider_reference
  (with a uniqueness rule so the same payment webhook can never be
  processed twice)
- Commission: total_amount, agency_share, agent_share, paid_to_landlord
  (a booking made directly with a landlord has NO commission row at
  all, not a zero-value one)
- The reservation service: acquires a 7-minute lock on the specific
  unit before creating a booking, releases it permanently on payment
  success, releases it immediately on failure or timeout

NEW — Contract: attaches to a completed Booking, contract_type
(lease/sale/service_agreement), signed_at, digital_signature_hash,
attached_files (lease PDF, ID copies).

NEW — a generalized PaymentGateway interface so MTN MoMo, Orange Money,
and card payments are interchangeable behind the same Booking/Escrow
flow — adding a new payment method later never requires touching the
Booking logic.

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- CinetPay or Monetbil (Mobile Money + card payment aggregator covering
  MTN MoMo, Orange Money, and cards through ONE integration) —
  per-transaction fee, typically 1.5–3%, no fixed monthly cost; requires
  a registered business to open a merchant account
- Redis (for the distributed booking lock) — hosting via Upstash or
  Railway, roughly $0–15/month depending on usage tier
- DocuSign API or Dropbox Sign API (for the Contract e-signature) —
  either a per-envelope fee or a monthly subscription tier (confirm
  current pricing directly; both offer a free developer sandbox)

ACCEPTANCE CRITERIA:
- Run the existing automated "rent a house" test and confirm it passes.
- Ask to see a real sandbox Mobile Money payment complete successfully
  and the booking status change to "Confirmed."
- Ask to see two people try to book the same unit at the same second in
  a test, and confirm only one succeeds.
```

---

## PROMPT 6 — Agency, Agent & Commission System

```
Build out the agency/agent business layer on top of the existing
AgentProfile/AgencyProfile models.

DETAILED REQUIREMENTS:
- AgencyBenefit: benefit_type (shared_lead_pool/inherited_agency_badge/
  marketing_support/bulk_listing_tools/training_resources),
  description — attached to each AgencyProfile so a prospective agent
  can see exactly what joining offers before deciding.
- A commission calculation service: reads the AgentProfile's
  commission_rate and, if it belongs to an AgencyProfile, splits the
  commission between agent and agency per the AgencyProfile's
  commission_policy. A booking made directly with a landlord (no agent
  involved) must produce NO commission record.
- Agent performance scoring: average response time to enquiries,
  percentage of listings with verified documents, number of completed
  deals — displayed on a public agent profile page.
- Agency roster management: an agency admin can add/remove agents,
  view each agent's individual performance, and see agency-wide
  aggregated commission totals.

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- None new — this builds entirely on the payment/escrow system from
  Prompt 5.

ACCEPTANCE CRITERIA:
- Ask to see a test agency with two agents under it, each closing a
  test deal, and confirm the commission split correctly between agent
  and agency in each case.
- Ask to see a test deal made directly with a landlord and confirm zero
  commission was generated.
```

---

## PROMPT 7 — Social, Engagement, Content Lifecycle & Referrals

```
Build out the `social` app fully (currently only a placeholder comment
exists — no real code).

DETAILED REQUIREMENTS:
- Post: author, media (photos/video/audio), caption, linked_listing
  (optional), poster_attribution (see below), content_status (draft/
  scheduled/pending_review/published/closed), scheduled_publish_at
- PosterAttribution: poster_role (landlord/independent_agent/
  agency_agent), posted_from (location), posted_at — mandatory on
  every Post, shown to every viewer
- Follow, Like/Reaction (with emoji type), Comment (with edit() and
  delete() by the original author only), Review (rating + text, tied to
  a completed Booking so only real transactors can review, with edit()
  and delete()), Rating (separate lightweight star rating on agents/
  agencies/properties)
- ShareEvent: records which channel (WhatsApp/SMS/Facebook/TikTok/
  LinkedIn/in-app) a listing or post was shared through
- Referral: referrer, referred_user, status, reward_earned — tracked as
  a first-class record, not just a promo code, with an audit trail for
  payouts
- Group and Conversation/Message: public community groups and private
  one-to-one chat, both logged for accountability
- Favorite: a private save, distinct from Follow (following a person)
  and ShareEvent (sharing to others)
- CelebrationEvent: type (birthday/new_year/national_day/platform_
  anniversary), triggers an automatic greeting through the shared
  notification system — birthday reads from KYCProfile.date_of_birth;
  national days are scoped per Country (not hardcoded to Cameroon)
- RecommendationFeed: a personalized, ranked feed reading each user's
  interaction history (likes, follows, saved searches, viewed
  listings) — the "algorithm suggests posts/videos" requirement

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- Cloudinary (photo/video/audio storage, compression, and delivery) —
  free tier to start, then usage-based on storage + bandwidth
- Google Cloud Translation API (optional, for auto-translating chat
  messages between English/French/Pidgin) — usage-based, billed per
  character translated

ACCEPTANCE CRITERIA:
- Ask for a short screen recording showing: a landlord posting a video
  (showing their role, location, and time), another test user liking,
  commenting, and favoriting it, and the post correctly staying hidden
  until its scheduled publish time passes.
- Ask to see a completed test referral show up with a tracked reward.
```

---

## PROMPT 8 — Advertising, Monetization & Platform Fees

```
Create a new `monetization` app.

DETAILED REQUIREMENTS:
- AdCampaign: owner (any User — landlord/agent/agency), budget,
  spent_so_far, starts_at, ends_at, status, placement (feed_boosted_
  post/search_top_placement/quarter_featured_listing), audience_filter
  (target quarter + property type)
- BoostedContent: wraps a Listing or Post with a priority_rank in the
  feed
- AdImpression and AdClick: tracked per campaign for real ROI reporting
- PlatformFeePolicy: fee_percent set per transaction_category
  (property_booking/marketplace_sale/service_payment/ad_spend) — ONE
  shared mechanism applied to every money-moving transaction on the
  platform, not a special case per feature. The fee should be small and
  not prominently displayed as a separate line item (per the "barely
  noticeable" requirement) but must be fully auditable in the admin
  console.
- NEW — SubscriptionTier: for agents/agencies — Free, Basic, Pro,
  Featured tiers (matching the Terres.cm-derived pricing model:
  roughly 10,000 XAF/month Basic, 35,000 XAF/month Pro, plus one-time
  featured boosts), each unlocking a different number of active
  listings and visibility features.

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- Same payment gateway as Prompt 5 (CinetPay/Monetbil) handles ad
  purchases and subscription billing — no new provider needed, but
  confirm recurring/subscription billing is supported by whichever one
  you chose (not all Mobile Money aggregators support auto-recurring
  charges; Monetbil supports recurring where CinetPay may require a
  manual renewal flow — confirm current capability before committing)

ACCEPTANCE CRITERIA:
- Ask to see a test ad campaign created with a budget and quarter
  target, and confirm it appears higher in a test search within that
  quarter than an equivalent non-boosted listing.
- Ask to see the platform fee correctly deducted on a test booking,
  test marketplace sale, and test ad purchase, using the same
  underlying calculation.
```

---

## PROMPT 9 — Trust, Safety & AI Content Moderation

```
Create a new `trust_safety` app.

DETAILED REQUIREMENTS:
- ContentReport: reported_by, reason (scam_suspected/inappropriate_
  content/harassment/misleading_listing/other), status, target
  (any Post/Listing/Comment)
- AIModerationResult: category (text_profanity/image_nudity/sexual_
  content/hate_speech/spam), confidence_score, action (allow/flag_for_
  review/auto_remove/escalate_admin), model_version, scored_at
- UserWarning: reason (ai_flagged_content/admin_reviewed_report/
  repeated_violation), strike_number, issued_by, acknowledged — repeat
  offenders accumulate strikes; define (and ask me to confirm) what
  happens at 3 strikes (temporary suspension) and 5 strikes (permanent
  ban), since this is a real policy decision, not just a technical one
- Every new Post and Listing must be scored automatically BEFORE it
  becomes publicly visible — moderation is not optional/after-the-fact

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- OpenAI Moderation API or Anthropic's content classification (text:
  profanity, hate speech, harassment) — usage-based, typically low cost
  per request; OpenAI's dedicated moderation endpoint is free as of
  this writing but confirm current terms
- Google Cloud Vision API — SafeSearch detection (image: nudity, sexual
  content, violence) — usage-based, billed per image processed, with a
  monthly free quota

ACCEPTANCE CRITERIA:
- Ask to see a deliberately inappropriate test image correctly get
  auto-flagged before going live, and a normal test photo publish
  immediately without delay.
- Ask to see a filed test report correctly show up in the Admin
  moderation queue.
```

---

## PROMPT 10 — Taskln Integration: Technician Services Subset

```
Build out the `services` app (currently a placeholder) as a scoped
subset of the separate Taskln platform.

DETAILED REQUIREMENTS:
- TechnicianProfile: specialties limited to a FIXED list —
  plumbing, electrical, painting, surveying, architecture, cleaning,
  moving, security_installation — deliberately narrower than Taskln's
  full open-ended profession list
- ServiceRequest: requester, technician, category, linked to a Booking
  from Prompt 5 (service payments must use Oaziland's own escrow
  system, never Taskln's payment rails directly)
- A read-only integration point that can display a Taskln worker's
  real-estate-relevant credentials without importing Taskln's token
  economy or community-vouching system
- Leave the specific question of "does a Taskln-verified worker arrive
  pre-verified on Oaziland" as an open configuration flag, not a hard
  decision baked into the code — I need to confirm this before it's
  finalized

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- None new, assuming Taskln's own API (once it exists) is used for the
  read-only worker lookup — if Taskln isn't built yet, mock this
  integration with placeholder data and flag it clearly as temporary

ACCEPTANCE CRITERIA:
- Ask to see a test service request for a plumber, paid through
  Oaziland's own payment system, complete successfully.
```

---

## PROMPT 11 — Hospitality: Student Hostels (Priority Module)

```
Build out the `hospitality` app's student_hostels module — the
priority hospitality module per the agreed launch sequencing (fastest
path to revenue via the ICT University relationship). Leave hotels,
events, and guest_houses as documented plans for a later prompt.

DETAILED REQUIREMENTS:
- StudentHostel (extends Building): institution_partnership (optional
  link to a partner institution)
- HostelRoom (extends Unit): room_type (single/double/triple/quad/
  postgrad/international)
- RoomAllocation: student, room, semester, priority-weighted assignment
  considering accessibility needs, international status, programme/
  year grouping, gender matching, roommate preference, and payment
  status — in that priority order
- Semester: institution-configurable academic calendar (not hardcoded
  to one university's dates)
- HostelBilling: semester-based due dates (not nightly rates), using
  the same Mobile Money payment flow as Prompt 5
- ParentGuardianAccess: consent-gated, READ-ONLY view for a parent onto
  billing and welfare status only — never onto maintenance requests,
  disciplinary records, or guest logs
- WelfareAlert: reason (payment_distress/prolonged_absence/safety_
  risk/behavioural_concern/medical_incident/roommate_conflict),
  access-controlled, routed to hostel management and — only where
  consented — the institution's student affairs contact

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- None new beyond the existing payment gateway from Prompt 5

ACCEPTANCE CRITERIA:
- Ask to see a test student correctly allocated a room for a semester,
  billed correctly, and a test parent account able to see the bill but
  confirm they CANNOT see maintenance requests or disciplinary notes.
```

---

## PROMPT 12 — Search, Discovery, Recommendations & Saved Searches

```
Build the search and discovery layer that ties every property type and
the social feed together.

DETAILED REQUIREMENTS:
- Full-text and filtered search across all property types: price,
  size, bedrooms, quarter, zoning, utilities, road type, distance to
  points of interest (Prompt 3)
- Map-first search with a draw-your-own-search-area tool
- SavedSearch: a user saves a search (e.g. "2BR under 100,000 XAF in
  Bastos") and gets notified automatically the moment a matching
  listing publishes
- PropertyComparison: side-by-side comparison of 2–4 shortlisted
  listings
- VisualSearch: upload a photo of a house seen elsewhere; the system
  finds visually similar listings in the database
- The RecommendationFeed from Prompt 7 extended to also rank Listings,
  not just Posts, in a personalized "suggested for you" feed

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- Meilisearch (self-hosted, free — pay only for the small server it
  runs on, roughly $5–20/month) recommended to start; Algolia (fully
  managed, usage-based monthly subscription, more expensive but zero
  server management) as a later upgrade if budget allows
- Google Cloud Vision API (Product Search / image similarity feature)
  for the visual search feature — usage-based, same account as Prompt 9

ACCEPTANCE CRITERIA:
- Ask to save a test search and confirm you receive a real notification
  when a matching test listing is published.
- Ask to upload a photo of a house and see visually similar listings
  returned.
```

---

## PROMPT 13 — Financial Tools: Wallet, Valuation & Affordability

```
Build the financial utilities that sit on top of the payment system.

DETAILED REQUIREMENTS:
- InAppWallet: a stored balance per user for faster repeat payments
  (avoiding re-entering Mobile Money details every time), with a full
  transaction history
- AutomatedValuationModel (AVM): a simple first-version estimator that
  computes an estimated rent/sale range for an address based on
  comparable listings in the same quarter (using the QuarterPriceTrend
  data from Prompt 3) — start with a straightforward averaging model,
  not a complex machine-learning model, and clearly label estimates as
  approximate
- AffordabilityCalculator: a simple input-your-income tool that
  suggests a realistic rent/price range
- EarningsReport: exportable (PDF/CSV) income summaries for landlords
  and agents, pulling from the Commission and PaymentEscrow records
- Multi-currency display: store all amounts in XAF internally but
  display converted estimates in USD/EUR for diaspora users

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- exchangerate-api.com or a similar currency conversion API — free
  tier available for low request volume, paid tiers beyond that
- No new payment provider — the InAppWallet uses the same CinetPay/
  Monetbil integration from Prompt 5 to top up and withdraw

ACCEPTANCE CRITERIA:
- Ask to top up a test wallet and pay for a test booking using wallet
  balance instead of re-entering Mobile Money details.
- Ask to see a test landlord export an earnings report as a PDF.
```

---

## PROMPT 14 — Property Management: Maintenance, Leases & Safety

```
Build the post-booking property management tools for landlords/
agencies and the safety tools for agents.

DETAILED REQUIREMENTS:
- MaintenanceRequest: property, reported_by, category (routine/
  emergency), description, cost_estimate, status, cost_history — an
  ongoing log per property, separate from the one-off technician
  booking flow in Prompt 10
- LeaseRenewalReminder: automatic prompts sent as a tenancy's end date
  approaches (60 days, 30 days, 7 days out)
- TenantScreening: allows a landlord to request a tenant's rental
  history and platform track record (completed bookings, review score,
  any warnings) before approving — with the tenant's explicit consent
  required before their history is shared
- AgentSafetyCheckIn: an agent doing a solo property visit can start a
  timed check-in; if they don't check out within the expected window,
  an alert goes to a designated emergency contact and platform admin
- DisputeCase: attached to an escrow dispute (from Prompt 5), with a
  defined resolution SLA (e.g. Admin must respond within 48 hours,
  resolve within 7 days) and a status trail

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- Same SMS/notification provider as Prompt 2 (Africa's Talking/Twilio)
  for the safety check-in alerts and lease renewal reminders — no new
  account needed, just additional usage on the existing one

ACCEPTANCE CRITERIA:
- Ask to see a test maintenance request logged, costed, and closed.
- Ask to see a test agent start a safety check-in, let the timer
  expire, and confirm a real alert was sent.
```

---

## PROMPT 15 — Role Dashboards & Navigation Architecture

```
Build the full state-aware navigation and every role-specific
dashboard, following the navigation architecture already designed.

DETAILED REQUIREMENTS:
- Public navigation (logged out): Home with hero search, Explore
  Properties mega-menu, Book Guest Houses, Student Housing, Taskln
  (services marketplace), About/Services/Blog/Contact
- Authenticated header: Saved Listings & Searches, Wallet, Account
  Security (MFA management), Language toggle, Role Switcher
- Landlord/Host Dashboard: overview charts (occupancy, revenue),
  inventory manager, reservations ledger, financial matrix (escrow
  balance, payout history), maintenance & workforce view
- Technician Dashboard: job dispatch ledger, routine inspection logs,
  earnings wallet console
- Agent/Agency Dashboard: lead capture CRM (using InteractionLog),
  showing scheduler, assigned listing portfolio, commission tracker,
  agency roster (agency-level only)
- Admin Console: verification queue, moderation queue (Prompt 9),
  escrow dispute panel (Prompt 14), platform-wide analytics
- NEW — GamifiedBadge: "Top Reviewer," "Verified Renter," "5 Successful
  Deals" — status badges displayed on profiles to build trust
- NEW — Waitlist: for a high-demand listing that's currently reserved,
  interested users can join a waitlist and get notified automatically
  if the reservation falls through

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- PostHog or Google Analytics (for the platform analytics dashboards) —
  both have a generous free tier suitable for early-stage usage

ACCEPTANCE CRITERIA:
- Log in as four different test accounts (landlord, agent, technician,
  admin) and confirm each sees a genuinely different dashboard suited
  to their role, not the same screen with labels changed.
```

---

## PROMPT 16 — The REST API Layer

```
Using Django REST Framework, expose every app built in Prompts 2–15 as
a documented, permission-controlled API for the web and mobile apps to
call.

DETAILED REQUIREMENTS:
- Apply Role-Based Access Control exactly per the Pre-Development
  Design Package's RBAC matrix (e.g. only Admin can approve a listing;
  an Agency only sees its own agents' data)
- Every endpoint validates and sanitizes input, and returns clear error
  messages
- Generate interactive Swagger/OpenAPI documentation so both of us can
  test every endpoint in a browser
- Implement API rate limiting to prevent abuse

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- None new

ACCEPTANCE CRITERIA:
- Open the Swagger documentation yourself, test the property search
  endpoint, and confirm real results come back.
```

---

## PROMPT 17 — Web App (Next.js): Full Build

```
Build the complete web application in Next.js, connected to the API
from Prompt 16.

DETAILED REQUIREMENTS — build these in order:
1. Home page (hero search, desktop mega-menus per the responsive
   design table already specified — collapsing to a hamburger drawer
   on mobile)
2. Search results (server-rendered for SEO) with map view and filters
3. Listing detail page (server-rendered, schema.org structured data)
4. Sign up / log in (Google, Facebook, normal, MFA)
5. List-a-property wizard (with bulk unit creation from Prompt 4)
6. All six role dashboards from Prompt 15
7. Social feed, post creation (with scheduling/drafts from Prompt 7)
8. Checkout/payment flow
9. Wallet, earnings reports, saved searches, comparison tool
10. PWA offline caching (service worker + IndexedDB) so recently
    viewed listings and drafts work without a connection

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- Vercel (hosting) — free tier to start, Pro tier (~$20/month per team
  member) as traffic grows
- Domain registration — $10–20/year

ACCEPTANCE CRITERIA:
- Browse the live staging site yourself, complete a full test search-
  to-booking flow, and resize your browser to confirm the mobile layout
  changes correctly.
```

---

## PROMPT 18 — Mobile App (React Native/Expo): Full Build

```
Build the complete mobile app in React Native, connected to the same
API as the web app.

DETAILED REQUIREMENTS:
- All the same core screens as Prompt 17, adapted for mobile
- Offline sync via WatermelonDB or SQLite, using the idempotency-key
  pattern from Prompt 5 so retried actions never duplicate
- Push notifications (booking confirmations, price-drop alerts, saved-
  search matches)
- Biometric app login (fingerprint/Face ID) in addition to MFA
- Camera integration for listing photos/videos and KYC document capture

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- Firebase Cloud Messaging (push notifications) — Free
- Apple Developer Program — $99/year (required to distribute on iOS)
- Google Play Developer account — $25 one-time (required to distribute
  on Android)

ACCEPTANCE CRITERIA:
- Install the test build on your own phone via TestFlight (iOS) or a
  direct APK/internal testing link (Android), complete a test booking,
  and confirm a real push notification arrives.
```

---

## PROMPT 19 — WhatsApp, SMS & Email Communication Layer

```
Wire up every outbound communication channel referenced throughout the
platform (booking confirmations, OTPs, lease reminders, welfare alerts,
marketing).

DETAILED REQUIREMENTS:
- A single NotificationChannel service other apps call, rather than
  each feature integrating WhatsApp/SMS/email separately
- WhatsApp: booking confirmations, receipts, one-tap "Chat on WhatsApp"
  buttons pre-filled with property details
- SMS: OTP delivery, fallback for low-connectivity areas
- Email: receipts, password resets, weekly digest summaries

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- WhatsApp Business API via Twilio or 360dialog — per-message fee,
  plus some providers charge a monthly platform fee on top; WhatsApp
  template messages must be pre-approved by Meta before use
- SMS: same provider as Prompt 2 (Africa's Talking/Twilio)
- Email: Postmark or SendGrid — free tier (typically up to a few
  thousand emails/month), then volume-based pricing

ACCEPTANCE CRITERIA:
- Ask to receive a real WhatsApp booking confirmation and a real
  transactional email on a test booking.
```

---

## PROMPT 20 — Consent, Privacy & Regulatory Compliance

```
Given how much personal data this platform collects (KYC documents,
ID numbers, location, payment details), build the consent and
data-rights layer required for responsible operation.

DETAILED REQUIREMENTS:
- ConsentRecord: tracks exactly what a user agreed to and when (terms
  of service, KYC data sharing, marketing communications, parent-
  guardian hostel access)
- Data export: a user can request and download all their stored data
- Data deletion: a user can request account deletion, with a clear
  policy on what must legally be retained (financial records) versus
  what is actually deleted
- A published, plain-language Privacy Policy and Terms of Service
  (I will need to review and approve the actual legal wording — this
  prompt builds the technical mechanism, not the legal text itself)

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- None technical — but budget for a lawyer's review of the Privacy
  Policy and Terms of Service before launch; this is not optional given
  the KYC/biometric data being collected

ACCEPTANCE CRITERIA:
- Ask to see a test account successfully export its data and confirm
  a test deletion request correctly removes what it should while
  retaining what's legally required.
```

---

## PROMPT 21 — Testing & Quality Assurance

```
Run a complete testing pass across the whole platform before launch.

DETAILED REQUIREMENTS:
- Automated end-to-end tests covering the full booking flow for at
  least three different property types (a house rental, a land
  reservation, a student hostel allocation)
- Load testing focused specifically on concurrent booking attempts on
  the same unit (the platform's highest-risk race condition)
- Security review: authentication, payment webhook signature
  verification, KYC data handling, API permission boundaries
- Bilingual QA pass (English/French) across both apps
- User Acceptance Testing with 3–5 real landlords, agents, and students

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- Sentry (error tracking during testing and beyond) — free tier for
  early stage, then usage-based

ACCEPTANCE CRITERIA:
- Receive a written, plain-language summary of what was tested, what
  passed, and what still needs fixing — you should not need to
  interpret raw test output yourself.
```

---

## PROMPT 22 — Deployment & Going Live

```
Deploy the finished platform to production.

DETAILED REQUIREMENTS:
1. Backend and PostgreSQL database to production hosting
2. Web app to Vercel with the real domain connected and SSL active
3. Mobile app submitted to the Apple App Store and Google Play Store
4. Switch every third-party integration from sandbox to production
   credentials (payment gateway, KYC, WhatsApp/SMS, moderation AI)
5. Final full smoke test of the booking flow using real (small-value)
   money before public announcement
6. A documented rollback plan for the first 48 hours post-launch

REQUIRED APIs & SUBSCRIPTIONS FOR THIS PROMPT:
- Backend hosting: Railway, Render, or Fly.io — roughly $20–100/month
  depending on load
- Managed PostgreSQL: Supabase or equivalent — free tier to start,
  ~$25+/month as data grows
- All production credentials for every service listed in Appendix A

ACCEPTANCE CRITERIA:
- Visit the live public domain from your own phone and computer,
  complete one real test booking, and confirm a real confirmation
  arrives via WhatsApp/SMS/email.
```

---

## Appendix A — Master API & Subscription Checklist (Budgeting Reference)

| # | Service | Used In | Pricing Model | Fixed Monthly Cost |
|---|---|---|---|---|
| 1 | Google OAuth | Prompt 2 | Free | $0 |
| 2 | Facebook Login | Prompt 2 | Free | $0 |
| 3 | Africa's Talking or Twilio Verify (SMS OTP) | Prompts 2, 14, 19 | Per-message (~$0.01–0.05) | $0 fixed |
| 4 | Smile Identity (KYC) | Prompt 2 | Per-verification | $0 fixed |
| 5 | OpenStreetMap | Prompt 3 | Free | $0 |
| 6 | Google Maps Platform (optional) | Prompt 3 | Free credit then usage | Variable |
| 7 | CinetPay or Monetbil (payments) | Prompts 5, 8, 13 | 1.5–3% per transaction | $0 fixed |
| 8 | Redis hosting (Upstash/Railway) | Prompt 5 | Tiered | ~$0–15 |
| 9 | DocuSign / Dropbox Sign | Prompt 5 | Per-envelope or subscription | Varies |
| 10 | Cloudinary | Prompt 7 | Free tier then usage | $0–variable |
| 11 | Google Cloud Translation (optional) | Prompt 7 | Per-character | Variable |
| 12 | OpenAI/Anthropic moderation | Prompt 9 | Usage-based | $0–variable |
| 13 | Google Cloud Vision (SafeSearch + visual search) | Prompts 9, 12 | Usage-based, free quota | $0–variable |
| 14 | Meilisearch (self-hosted) | Prompt 12 | Server cost only | ~$5–20 |
| 15 | exchangerate-api.com | Prompt 13 | Free tier then paid | $0–variable |
| 16 | PostHog or Google Analytics | Prompt 15 | Free tier | $0 |
| 17 | Vercel | Prompt 17 | Free then Pro | $0–20/member |
| 18 | Domain registration | Prompt 17 | Annual | ~$1–2/mo equivalent |
| 19 | Firebase Cloud Messaging | Prompt 18 | Free | $0 |
| 20 | Apple Developer Program | Prompt 18 | Annual | ~$8.25/mo equivalent |
| 21 | Google Play Developer | Prompt 18 | One-time | $25 once |
| 22 | WhatsApp Business API (Twilio/360dialog) | Prompt 19 | Per-message + possible platform fee | Variable |
| 23 | Postmark or SendGrid | Prompt 19 | Free tier then volume | $0–variable |
| 24 | Sentry | Prompt 21 | Free tier then usage | $0–variable |
| 25 | Backend hosting (Railway/Render/Fly.io) | Prompt 22 | Tiered | ~$20–100 |
| 26 | Managed PostgreSQL (Supabase) | Prompt 22 | Free tier then tiered | $0–25+ |

**Reading this table:** most costs here are usage-based, meaning they scale with real activity (transactions, messages, verifications) rather than being a flat bill you pay whether or not the platform is being used. The genuinely fixed, unavoidable costs before a single user signs up are: Apple Developer ($99/yr), Google Play ($25 one-time), domain registration, and whatever backend/database hosting tier you choose to start on.

---

## A Note on Pacing

Prompts 2–5 (Identity/Auth, Geography, Property/Land, Transactions) form a genuinely complete, testable backend foundation on their own — a real milestone worth pausing at to show an advisor or investor before committing further budget to Prompts 6–22.

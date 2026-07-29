# Oaziland — Django Backend (In Progress)

This is real, tested, running code — not a mockup. Every claim below is
backed by an automated test you can run yourself.

## What's fully built and verified (run these to see for yourself)

```bash
python -m venv venv && source venv/bin/activate
pip install django djangorestframework
cd oaziland
python manage.py migrate
python smoke_test.py     # rent-a-house end-to-end, including a race condition test
python smoke_test_2.py   # social, monetization, and moderation features
```

**identity** — custom User (phone-based) + 6 Role profiles (Landlord, Agent,
Agency, Student, Technician, Admin) + Google/Facebook social login (linked
to one account, never duplicated) + multi-factor authentication (SMS/app/
email codes, with used-code and expiry protection tested) + mandatory KYC.

**geo** — full Country → Region → Division → Subdivision → Village →
Quarter hierarchy.

**property / land** — the polymorphic property hierarchy (House, Building
+ Units, Commercial Space, Shop) and the Land trust layer (title deeds,
verification badges, boundary polygons, scam flags).

**transactions** — Booking → PaymentEscrow → Commission, with a working
reservation service: a 7-minute hold lock, correctly rejects a second
person trying to book the same unit, confirms on payment, releases escrow
on completion. This is the platform's highest-risk piece and it's the
most thoroughly tested part of the codebase.

**social** — Posts (with mandatory poster-role/location/time attribution),
Follow, Reactions, Comments (with author-only edit/delete, tested against
a deliberate permission-violation attempt), Reviews, Ratings, ShareEvents,
Referrals, Groups, Conversations/Messages, Favorites, and scheduled
birthday/holiday greetings.

**monetization** — Ad campaigns with budget tracking, a single shared
platform-fee calculator used identically across booking/marketplace/
service/ad transactions (tested), agency membership benefits, and
subscription tiers.

**trust_safety** — user content reporting, an AI-moderation-result
structure (the actual AI call is still a placeholder — see below), and a
warning/strike system with auto-incrementing strike numbers.

## What's still a placeholder, not real

- **AI moderation**: the data structure exists and is tested, but no real
  call to OpenAI/Anthropic or Google Cloud Vision has been wired in yet —
  that's Prompt 9's remaining work once you have API credentials
- **Payment gateway**: PaymentEscrow's data model and logic are complete
  and tested, but no real CinetPay/Monetbil integration exists yet —
  it's designed to plug in without changing the Booking logic
- **hospitality, services (Taskln), student marketplace**: scaffolded
  with clear docstrings pointing to what they'll contain, no models yet
- **No API layer**: Django REST Framework is installed but no
  serializers/views written — this is Prompt 16
- **No web or mobile app yet** — Prompts 17-18

## Honest summary of where this stands

Prompts 2 (Identity/Auth/KYC), 4 (Property/Land), 5 (Transactions), 7
(Social), 8 (Monetization), and 9 (Trust & Safety) from the Build Prompts
document are now genuinely, testably done at the data-model layer. That's
a real, substantial foundation — but it's still a backend with no way for
a real user to touch it yet. The API layer (Prompt 16) is the natural
next step, since it's what makes this usable by any actual app.

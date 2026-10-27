# Oaziland — Web App

Next.js (App Router) web application, built per Prompt 17. Connects to
the Django API from Prompt 16.

## Pages built (in the order Prompt 17 specifies)
1. `/` — Home page with the hero search bar
2. `/search` — Property search results (server-rendered, for SEO)
3. `/listing/[id]` — Individual listing detail (server-rendered, with
   schema.org structured data for rich search results)
4. `/register` and `/login` — Username/password sign up and sign in.
   Google/Facebook actions are hidden until OAuth is implemented.
5. `/list-property` — A basic listing creation form, enforcing the same
   MFA+KYC rule as the backend API

## Public browsing design

- The homepage uses a clean navy hero, without text or controls baked into
  an image. Featured listings precede the service directory; optional welcome
  choices are inline rather than a blocking first-visit modal.
- Property search keeps the current language and submits the actual maximum
  price in XAF. Hotels and student residences link to their dedicated browsing
  pages rather than presenting unsupported filters in the homepage form.
- Failed property/hotel requests show an explicit retry state, not zero results
  or sample inventory. Hotel examples shown for an empty catalogue are labelled
  illustrative and cannot open checkout.
- On phones, the closed support launcher stays in document flow after the
  footer, so it cannot cover form actions. Opening it displays the chat panel
  above the bottom navigation. Desktop retains the floating launcher.

## Offline caching
`public/sw.js` is a real service worker (network-first, falls back to
cache when offline) registered via `components/ServiceWorkerRegister.tsx`.
Previously viewed pages remain browsable with no connection.

## Running locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Requires the Django backend (`/backend`) running on the URL configured
in `.env.local` (defaults to `http://localhost:8000`).

## What's NOT built yet
- Google/Facebook OAuth (actions hidden, backend not connected — needs real
  credentials, per Prompt 2)
- Property-type-specific listing detail fields (bedrooms, land title
  info, etc.) beyond the basic fields already shown
- Every other app's dedicated pages (social feed, hospitality,
  marketplace, dashboards) — this pass covers exactly what Prompt 17
  asks for; extending to the rest follows the same page/component
  pattern already established here

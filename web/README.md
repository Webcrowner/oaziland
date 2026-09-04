# Oaziland — Web App

Next.js (App Router) web application, built per Prompt 17. Connects to
the Django API from Prompt 16.

## Pages built (in the order Prompt 17 specifies)
1. `/` — Home page with the hero search bar
2. `/search` — Property search results (server-rendered, for SEO)
3. `/listing/[id]` — Individual listing detail (server-rendered, with
   schema.org structured data for rich search results)
4. `/register` and `/login` — Sign up / log in (Google/Facebook buttons
   are present in the UI but NOT yet connected — same "not yet
   connected" flag as the rest of this project's external integrations)
5. `/list-property` — A basic listing creation form, enforcing the same
   MFA+KYC rule as the backend API

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
- Google/Facebook OAuth (UI present, backend not connected — needs real
  credentials, per Prompt 2)
- Property-type-specific listing detail fields (bedrooms, land title
  info, etc.) beyond the basic fields already shown
- Every other app's dedicated pages (social feed, hospitality,
  marketplace, dashboards) — this pass covers exactly what Prompt 17
  asks for; extending to the rest follows the same page/component
  pattern already established here

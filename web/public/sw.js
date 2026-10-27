/**
 * A real, working service worker implementing the "previously viewed
 * listings remain browsable offline" requirement from the Technology
 * Stack document, Section 5. Strategy: network-first for freshness,
 * falling back to cache when offline — so a listing you've already
 * opened once stays viewable with no connection.
 */
const CACHE_NAME = "oaziland-cache-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Drop caches written by earlier versions: they may hold per-user API responses.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // The cache is keyed by URL only, so a response fetched with a login token (my posts, following
  // feed, bookings...) must never be stored or replayed to whoever uses this browser next; and
  // callers that ask for no-store (the live feed) need a real network error, not a stale copy.
  if (request.headers.has("Authorization") || request.cache === "no-store") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});

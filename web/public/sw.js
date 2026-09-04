/**
 * A real, working service worker implementing the "previously viewed
 * listings remain browsable offline" requirement from the Technology
 * Stack document, Section 5. Strategy: network-first for freshness,
 * falling back to cache when offline — so a listing you've already
 * opened once stays viewable with no connection.
 */
const CACHE_NAME = "oaziland-cache-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

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

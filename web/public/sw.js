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

// Push notifications (ride offers, trip updates, messages...). The server sends JSON:
// { title, body, url, type, tag }. A tap opens (or focuses) the page the notification is about.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Oaziland", body: event.data ? event.data.text() : "" };
  }
  const urgent = data.type === "RIDE_OFFER" || data.type === "RIDE_SOS";
  event.waitUntil(
    self.registration.showNotification(data.title || "Oaziland", {
      body: data.body || "",
      icon: "/logo.png",
      badge: "/logo.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      requireInteraction: urgent,
      vibrate: urgent ? [300, 100, 300, 100, 300] : [200],
      data: { url: data.url || "/notifications" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Keep the language the person is already using (/en/... or /fr/...).
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      const locale = open ? (new URL(open.url).pathname.split("/")[1] || "en") : "en";
      const target = `/${["en", "fr"].includes(locale) ? locale : "en"}${path}`;
      if (open) return open.focus().then((w) => (w && "navigate" in w ? w.navigate(target) : self.clients.openWindow(target)));
      return self.clients.openWindow(target);
    })
  );
});

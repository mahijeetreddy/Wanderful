// Build replaces these constants with the exact hashed application asset allowlist.
const VERSION = "development";
const ASSETS = /* BUILD_ASSETS */ [];
const CACHE = `wanderful-shell-${VERSION}`;
self.addEventListener("install", event => {
  if (!ASSETS.length) return;
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("wanderful-shell-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (!ASSETS.length || request.method !== "GET" || url.origin !== self.location.origin || url.search || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" && ["/", "/index.html", "/offline"].includes(url.pathname)) {
    event.respondWith(fetch(request).catch(async () => url.pathname === "/offline" ? (await caches.open(CACHE)).match("/index.html") : Response.redirect("/offline", 302)));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(request)) || fetch(request)));
  }
});

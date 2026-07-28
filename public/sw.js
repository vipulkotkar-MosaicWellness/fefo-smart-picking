// Service worker: makes the app installable + gives a basic offline shell,
// WITHOUT trapping users on a stale build.
//
// Strategy:
//  - HTML (navigation requests): network-first. Users always get the latest
//    index.html (which references the latest hashed JS/CSS) when online;
//    only falls back to cache when offline.
//  - Hashed build assets (JS/CSS under /assets/, etc.): cache-first. Safe,
//    because Vite gives every build a new filename — a cache hit is always
//    for the exact content that filename means.
const CACHE = "fefo-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;

  const isHtml = req.mode === "navigate" || req.destination === "document";

  if (isHtml) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    }),
  );
});

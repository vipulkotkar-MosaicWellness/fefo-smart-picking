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
          // Clone synchronously, before returning res — the caller starts
          // consuming its body as soon as it's returned, and cloning after
          // that body is (even partly) read throws "Response body is
          // already used". Storing into the cache itself can stay async;
          // only the clone() call has to happen up front.
          const resToCache = res.clone();
          caches.open(CACHE).then((c) => c.put(req, resToCache));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          // Both the network AND the cache can come back empty (first-ever
          // load while offline) — respondWith() must always resolve to a
          // real Response, or the browser reports a hard network error
          // ("Failed to convert value to 'Response'") instead of this page.
          return cached || new Response("You're offline and this page hasn't been cached yet.", {
            status: 503,
            statusText: "Offline",
            headers: { "Content-Type": "text/plain" },
          });
        }),
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch {
        // Offline and this asset was never cached — an uncaught rejection
        // here would surface as the same hard network error as the HTML
        // case above, so resolve to a real (failing) Response instead.
        return new Response("Offline", { status: 503, statusText: "Offline" });
      }
    }),
  );
});

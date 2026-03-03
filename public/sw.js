const CACHE_VERSION = "atlas-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k.startsWith("atlas-") && k !== STATIC_CACHE) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

// Estratégia:
// - Navegação (páginas): network-first (se cair, mostra offline.html)
// - Assets (png/css/js): cache-first
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // só cuida do seu domínio
  if (url.origin !== self.location.origin) return;

  // 1) Navegação (HTML)
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        // tenta internet primeiro
        return await fetch(req);
      } catch (e) {
        // se falhar, mostra offline
        const cache = await caches.open(STATIC_CACHE);
        const offline = await cache.match("/offline.html");
        return offline || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // 2) Assets (cache-first)
  if (["style", "script", "image", "font"].includes(req.destination)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // 3) resto: tenta normal
  event.respondWith(fetch(req));
});

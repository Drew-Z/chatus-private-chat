const CACHE_NAME = "chatus-shell-v3";
const SHELL_ASSETS = [
  "/",
  "/admin",
  "/styles.css",
  "/app.js",
  "/admin.js",
  "/markdown.js",
  "/theme.js",
  "/pwa.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    const fallbackPath = url.pathname.startsWith("/admin") ? "/admin" : "/";
    const network = fetch(request).then(async (response) => {
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(fallbackPath, response.clone());
      }
      return response;
    });
    event.waitUntil(network.then(() => undefined).catch(() => undefined));
    event.respondWith(network.catch(() => caches.match(fallbackPath)));
    return;
  }

  const network = fetch(request).then(async (response) => {
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });
  event.waitUntil(network.then(() => undefined).catch(() => undefined));
  event.respondWith(network.catch(() => caches.match(request, { ignoreSearch: true })));
});

const CACHE_NAME = "chatus-shell-v7";
const SHELL_ASSETS = [
  "/",
  "/legacy/",
  "/styles.css",
  "/app.js",
  "/markdown.js",
  "/theme.js",
  "/pwa.js",
  "/icons.svg",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(cacheApplicationShell());
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
  if (
    url.origin !== self.location.origin
    || url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/agent")
    || url.pathname === "/release.json"
  ) return;

  if (request.mode === "navigate") {
    const fallbackPath = navigationCacheKey(url.pathname);
    const network = fetchNavigation(request, fallbackPath);
    event.waitUntil(network.then(() => undefined).catch(() => undefined));
    event.respondWith(network);
    return;
  }

  const cached = caches.match(request, { ignoreSearch: false });
  const network = fetch(request).then(async (response) => {
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });
  event.waitUntil(network.then(() => undefined).catch(() => undefined));
  event.respondWith(isFingerprintedAsset(url) ? cached.then((response) => response || network) : network.catch(() => cached));
});

async function fetchNavigation(request, fallbackPath) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(fallbackPath, response.clone());
      return response;
    }
    if (response.status === 404 || response.status >= 500) {
      return (await caches.match(fallbackPath)) || response;
    }
    return response;
  } catch {
    return (await caches.match(fallbackPath)) || Response.error();
  }
}

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(SHELL_ASSETS);
  const response = await fetch("/react-chat/");
  if (!response.ok) throw new Error("react_shell_unavailable");
  await cache.put("/react-chat/", response.clone());
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)=["'](\/react-chat\/assets\/[^"']+)["']/g)]
    .map((match) => match[1]);
  if (assets.length) await cache.addAll([...new Set(assets)]);
}

function navigationCacheKey(pathname) {
  if (pathname.startsWith("/legacy")) return "/legacy/";
  if (pathname.startsWith("/react-chat")) return "/react-chat/";
  return "/";
}

function isFingerprintedAsset(url) {
  return /^[0-9a-f]{40}$/i.test(url.searchParams.get("v") || "")
    || /^\/react-chat\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/i.test(url.pathname);
}

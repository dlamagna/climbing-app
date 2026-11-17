// App-shell cache so the app (and the hangboard timer) opens without signal.
// API calls are never cached here; the app keeps its own offline copies and write queue.
//
// The build (swPrecache in vite.config.ts) replaces the manifest placeholder below with this deploy's version and
// file list, so a new deploy installs with every file of its shell already cached and drops the old caches.
const MANIFEST = self.__SW_MANIFEST || { version: "dev", urls: ["/"] };
const PREFIX = "climb-";
const CACHE = PREFIX + MANIFEST.version;
// How long a page or file request waits for the network before the cached copy is served. A weak or captive
// connection can hang far longer than this without failing.
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  // All or nothing: if any file can't be fetched, this version doesn't install and the current one stays.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(MANIFEST.urls.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
  if (hit) return hit;
  // Every route is the same single-page app, so any navigation can be answered with the cached shell.
  if (request.mode === "navigate") return (await cache.match("/")) || (await cache.match("/index.html"));
  return undefined;
}

async function fetchAndCache(request) {
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, res.clone());
  }
  return res;
}

// Network first so deploys show up immediately, but give up on the network after NETWORK_TIMEOUT_MS (or as
// soon as it fails) when there is a cached copy to show. The network answer still updates the cache.
async function networkWithTimeout(event) {
  const network = fetchAndCache(event.request);
  event.waitUntil(network.catch(() => undefined));
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), NETWORK_TIMEOUT_MS);
  });
  try {
    const first = await Promise.race([network.catch(() => "failed"), timeout]);
    if (first !== "timeout" && first !== "failed") return first;
    const cached = await fromCache(event.request);
    if (cached) return cached;
    return await network; // nothing cached: keep waiting for the network
  } catch {
    return Response.error();
  } finally {
    clearTimeout(timer);
  }
}

// Built files under /assets/ have the content hash in their name and never change: serve them from the cache.
async function cacheFirst(event) {
  const cached = await fromCache(event.request);
  if (cached) return cached;
  return networkWithTimeout(event);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) return;
  event.respondWith(url.pathname.startsWith("/assets/") ? cacheFirst(event) : networkWithTimeout(event));
});

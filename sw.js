/* MarketLevelMap service worker (scope /). Market data must never be shown stale while the network works:
   - Pages (HTML): network-first; offline → the last copy of that page, else /offline.html.
   - /api/publication, /api/events, /api/archive (report JSON, analysis PNGs, events, archive): network-first;
     offline → the last copy, and the page is told so it can show an "offline" notice.
   - /api/prices: never cached (live prices come from the exchanges' streams; the page has its own short cache).
   - /assets/* (versioned CSS/JS, icons, logos, generated library data) and the manifest: stale-while-revalidate.
   - Other origins (Binance, Coinbase, data.marketlevelmap.com candles) and websockets: not touched.
   Bump VERSION when this file's rules change; old caches are deleted on activate. */
const VERSION = "mlm-v1";
const CACHES = { pages: `${VERSION}-pages`, data: `${VERSION}-data`, assets: `${VERSION}-assets` };
const LIMITS = { pages: 60, data: 80, assets: 120 };
const OFFLINE = "/offline"; // Pages serves /offline.html at /offline
const PRECACHE = [OFFLINE, "/manifest.webmanifest", "/assets/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHES.assets).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !Object.values(CACHES).includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Keep each cache to a bounded number of entries (oldest first out).
async function trim(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

async function store(name, request, response) {
  if (!response || response.status !== 200 || response.type !== "basic") return;
  const cache = await caches.open(name);
  await cache.put(request, response);
  await trim(name, LIMITS[Object.keys(CACHES).find((k) => CACHES[k] === name)]);
}

async function tellStale(clientId) {
  const client = clientId && (await self.clients.get(clientId));
  if (client) client.postMessage({ type: "mlm-offline-data" });
}

// Pages serves /page.html at /page (and /index.html at /), so a page cached at /page also answers links to
// /page.html while offline.
function cleanUrl(href) {
  const url = new URL(href);
  url.pathname = url.pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
  return url.href;
}

async function networkFirst(event, name, fallback) {
  const request = event.request;
  try {
    const response = await fetch(request);
    event.waitUntil(store(name, request, response.clone()));
    return response;
  } catch (error) {
    const cached = (await caches.match(request, { cacheName: name })) || (request.mode === "navigate" && (await caches.match(cleanUrl(request.url), { cacheName: name })));
    if (cached) {
      if (name === CACHES.data) event.waitUntil(tellStale(event.clientId));
      return cached;
    }
    if (fallback) {
      const page = await caches.match(fallback);
      // A fresh Response: a cached copy that went through a redirect cannot answer a navigation.
      return page ? new Response(await page.blob(), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }) : Response.error();
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(event, name) {
  const cached = await caches.match(event.request, { cacheName: name });
  const network = fetch(event.request).then((response) => { event.waitUntil(store(name, event.request, response.clone())); return response; });
  if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
  return network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // exchanges, candle data, anything cross-origin: untouched
  const path = url.pathname;
  if (path.startsWith("/api/prices")) return; // live prices: never from a cache
  if (path.startsWith("/api/")) return event.respondWith(networkFirst(event, CACHES.data));
  if (request.mode === "navigate") return event.respondWith(networkFirst(event, CACHES.pages, OFFLINE));
  if (path.startsWith("/assets/") || path === "/manifest.webmanifest") return event.respondWith(staleWhileRevalidate(event, CACHES.assets));
});

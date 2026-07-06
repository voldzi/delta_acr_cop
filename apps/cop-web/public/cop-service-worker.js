const COP_SW_VERSION = "cop-pwa-offline-20260626-1";
const APP_SHELL_CACHE = `${COP_SW_VERSION}:shell`;
const RUNTIME_CACHE = `${COP_SW_VERSION}:runtime`;
const TILE_CACHE = `${COP_SW_VERSION}:tiles`;
const MAP_RESOURCE_HOSTS = new Set(["tile.openstreetmap.org", "tiles.zeleznalady.cz", "demotiles.maplibre.org"]);
const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/site.webmanifest",
  "/icons/cop-icon.svg",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png",
  "/icons/cop-icon-192.png",
  "/icons/cop-icon-512.png",
  "/icons/cop-icon-maskable-512.png"
];
const API_PATH_PREFIXES = ["/api/", "/health", "/metrics"];
const MAX_RUNTIME_ENTRIES = 120;
const MAX_TILE_ENTRIES = 1200;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("cop-pwa-offline-") && !key.startsWith(COP_SW_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin && API_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }
  if (url.origin === self.location.origin && isChatRequestPath(url.pathname)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstAppShell(request));
    return;
  }

  if (isMapTileRequest(request, url)) {
    event.respondWith(cacheFirst(request, TILE_CACHE, MAX_TILE_ENTRIES));
    return;
  }

  if (url.origin === self.location.origin) {
    if (isAppAssetRequest(request, url)) {
      event.respondWith(networkFirstRuntime(request, RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
      return;
    }
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
  }
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event.data);
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "CSM";
  const body = typeof payload.body === "string" ? payload.body : undefined;
  const deepLink = normalizeNotificationUrl(payload.deepLink ?? payload.url ?? notificationPayloadUrl(payload));

  event.waitUntil(
    self.registration.showNotification(title, {
      badge: "/icons/favicon-32.png",
      body,
      data: {
        url: deepLink
      },
      icon: "/icons/cop-icon-192.png",
      renotify: false,
      tag: typeof payload.tag === "string" && payload.tag.trim() ? payload.tag.trim() : undefined
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = normalizeNotificationUrl(event.notification.data?.url) ?? "/";

  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then(async (clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })
  );
});

async function networkFirstAppShell(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put("/index.html", response.clone());
    }
    return response;
  } catch {
    return (await cache.match("/index.html")) || (await cache.match("/")) || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response && (response.ok || response.type === "opaque")) {
        await cache.put(request, response.clone());
        await trimCache(cache, maxEntries);
      }
      return response;
    })
    .catch(() => undefined);
  return cached || (await refresh) || Response.error();
}

async function networkFirstRuntime(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response && (response.ok || response.type === "opaque")) {
      await cache.put(request, response.clone());
      await trimCache(cache, maxEntries);
    }
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) {
    await cache.put(request, response.clone());
    await trimCache(cache, maxEntries);
  }
  return response;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) {
    return;
  }
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

function isMapTileRequest(request, url) {
  if (MAP_RESOURCE_HOSTS.has(url.hostname)) {
    return true;
  }
  if (url.pathname.startsWith("/osm/") || url.pathname.startsWith("/tiles/") || url.pathname.startsWith("/fonts/")) {
    return true;
  }
  if (request.destination === "image" && /tile|tiles|map/u.test(url.hostname + url.pathname)) {
    return true;
  }
  return request.destination === "font" && /font|glyph/u.test(url.hostname + url.pathname);
}

function isAppAssetRequest(request, url) {
  if (url.pathname === "/cop-service-worker.js" || url.pathname === "/site.webmanifest") {
    return true;
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    return true;
  }
  return ["script", "style", "worker", "manifest", "font"].includes(request.destination);
}

function isChatRequestPath(pathname) {
  return pathname === "/chat" || pathname.startsWith("/chat/");
}

function parsePushPayload(data) {
  if (!data) {
    return {};
  }
  try {
    return data.json();
  } catch {
    try {
      return { body: data.text() };
    } catch {
      return {};
    }
  }
}

function normalizeNotificationUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "/";
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("csm://map/alert/")) {
    return `/?alertId=${encodeURIComponent(trimmed.slice("csm://map/alert/".length))}`;
  }
  if (trimmed.startsWith("csm://map/report/")) {
    return `/?reportId=${encodeURIComponent(trimmed.slice("csm://map/report/".length))}`;
  }
  if (trimmed.startsWith("csm://chat/room/")) {
    return `/chat/${encodeURIComponent(trimmed.slice("csm://chat/room/".length))}`;
  }
  if (trimmed.startsWith("csm://chat/conversation/")) {
    return `/chat/${encodeURIComponent(trimmed.slice("csm://chat/conversation/".length))}`;
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.origin === self.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Unknown deep links open the app shell instead of leaking arbitrary URLs.
  }
  return "/";
}

function notificationPayloadUrl(payload) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  if (typeof payload.conversationId === "string" && payload.conversationId.trim()) {
    return `/chat/${encodeURIComponent(payload.conversationId.trim())}`;
  }
  if (typeof payload.roomId === "string" && payload.roomId.trim()) {
    return `/chat/${encodeURIComponent(payload.roomId.trim())}`;
  }
  if (payload.type === "chat.message" || payload.type === "message") {
    return "/chat/";
  }
  return undefined;
}

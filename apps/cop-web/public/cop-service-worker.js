const COP_SW_VERSION = "cop-pwa-offline-20260707-1";
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
  const severity = notificationPayloadSeverity(payload);
  const tag = notificationPayloadTag(payload);

  event.waitUntil(
    self.registration.showNotification(title, {
      actions: notificationActionsForUrl(deepLink),
      badge: "/icons/favicon-32.png",
      body,
      data: {
        receivedAt: Date.now(),
        severity,
        type: notificationPayloadType(payload),
        url: deepLink
      },
      icon: "/icons/cop-icon-192.png",
      requireInteraction: ["critical", "high"].includes(severity),
      renotify: false,
      tag,
      timestamp: Date.now()
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") {
    return;
  }

  const targetUrl = normalizeNotificationUrl(event.notification.data?.url) ?? "/";

  event.waitUntil(openBestClientWindow(targetUrl));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(notifyClients({ type: "cop:pwa:pushsubscriptionchange" }));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "cop:pwa:skip-waiting") {
    void self.skipWaiting();
  }
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
    // MapLibre rejects opaque responses served by a service worker as tile data.
    if (cached.ok && cached.type !== "opaque") {
      return cached;
    }
    await cache.delete(request);
  }

  const response = await fetch(request);
  // Cross-origin map resources must stay CORS-readable. Do not persist no-cors opaque responses.
  if (response && response.ok && response.type !== "opaque") {
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

async function openBestClientWindow(targetUrl) {
  const target = new URL(normalizeNotificationUrl(targetUrl) ?? "/", self.location.origin);
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  const rankedClients = clients
    .filter((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    })
    .map((client) => ({
      client,
      score: scoreClientForTarget(client, target)
    }))
    .sort((left, right) => right.score - left.score);

  const selected = rankedClients[0]?.client;
  if (selected) {
    const focused = "focus" in selected ? await selected.focus() : selected;
    if ("navigate" in focused) {
      await focused.navigate(`${target.pathname}${target.search}${target.hash}`);
    }
    return;
  }

  if (self.clients.openWindow) {
    await self.clients.openWindow(`${target.pathname}${target.search}${target.hash}`);
  }
}

function scoreClientForTarget(client, target) {
  const clientUrl = new URL(client.url);
  let score = 1;
  if (
    `${clientUrl.pathname}${clientUrl.search}${clientUrl.hash}` === `${target.pathname}${target.search}${target.hash}`
  ) {
    score += 20;
  }
  if (clientUrl.pathname === target.pathname) {
    score += 10;
  }
  if (isChatRequestPath(target.pathname) === isChatRequestPath(clientUrl.pathname)) {
    score += 5;
  }
  if (!isChatRequestPath(target.pathname) && !isChatRequestPath(clientUrl.pathname)) {
    score += 2;
  }
  return score;
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const client of clients) {
    client.postMessage(message);
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

function notificationActionsForUrl(url) {
  const actions = [{ action: "open", title: "Otevřít" }];
  if (url && isChatRequestPath(new URL(url, self.location.origin).pathname)) {
    actions[0] = { action: "open", title: "Otevřít chat" };
  }
  actions.push({ action: "dismiss", title: "Zavřít" });
  return actions;
}

function notificationPayloadSeverity(payload) {
  const candidates = [payload?.severity, payload?.priority, payload?.level, payload?.data?.severity];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const normalized = candidate.trim().toLowerCase();
      if (["critical", "high", "medium", "low", "info"].includes(normalized)) {
        return normalized;
      }
    }
  }
  return "info";
}

function notificationPayloadType(payload) {
  const candidates = [payload?.type, payload?.eventType, payload?.data?.type];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "notification";
}

function notificationPayloadTag(payload) {
  const explicitTag = firstString(payload?.tag, payload?.data?.tag);
  const type = notificationPayloadType(payload);
  const eventId = firstString(
    payload?.eventId,
    payload?.messageId,
    payload?.matrixEventId,
    payload?.data?.eventId,
    payload?.data?.messageId,
    payload?.data?.matrixEventId
  );
  if ((type === "chat.message" || type === "message") && eventId) {
    const scope = firstString(
      payload?.roomId,
      payload?.conversationId,
      payload?.data?.roomId,
      payload?.data?.conversationId
    );
    return `cop-chat-${safeNotificationTagPart(scope ?? "message")}-${safeNotificationTagPart(eventId)}`;
  }
  return explicitTag;
}

function firstString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function safeNotificationTagPart(value) {
  return String(value).replace(/\s+/gu, "_").slice(0, 140);
}

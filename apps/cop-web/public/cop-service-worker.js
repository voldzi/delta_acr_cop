const COP_SW_VERSION = "cop-pwa-offline-20260707-7";
const APP_SHELL_CACHE = `${COP_SW_VERSION}:shell`;
const RUNTIME_CACHE = `${COP_SW_VERSION}:runtime`;
const TILE_CACHE = `${COP_SW_VERSION}:tiles`;
const ROUTE_TILE_CACHE = `${COP_SW_VERSION}:route-tiles`;
const MAP_RESOURCE_HOSTS = new Set(["tile.openstreetmap.org", "tiles.zeleznalady.cz", "demotiles.maplibre.org"]);
const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/chat/",
  "/site.webmanifest",
  "/icons/cop-icon.svg",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png",
  "/icons/cop-icon-192.png",
  "/icons/cop-icon-512.png",
  "/icons/cop-icon-maskable-512.png"
];
const API_PATH_PREFIXES = ["/api/", "/health", "/metrics"];
const APP_SHELL_ASSET_ATTRIBUTE_PATTERN = /\b(?:href|src)=["']([^"']+)["']/giu;
const MAX_WARMED_APP_SHELL_ASSETS = 32;
const MAX_RUNTIME_ENTRIES = 120;
const MAX_TILE_ENTRIES = 1200;
const MAX_ROUTE_TILE_ENTRIES = 900;
const MAX_ROUTE_TILE_WARMUP_URLS = 650;
const RECENT_NOTIFICATION_TAG_TTL_MS = 120_000;
const recentNotificationTags = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => Promise.all(APP_SHELL_URLS.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => warmAppShellAssets().catch(() => undefined))
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

  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidateAppShell(request));
    return;
  }

  if (isMapTileRequest(request, url)) {
    event.respondWith(routeCacheFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    if (isImmutableRuntimeAssetRequest(request, url)) {
      event.respondWith(cacheFirst(request, RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
      return;
    }
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
  const badgeCount = notificationPayloadBadgeCount(payload);

  event.waitUntil(
    (async () => {
      if (badgeCount !== undefined) {
        await updateAppBadge(badgeCount);
      }
      if (await shouldSuppressDuplicateNotification(tag)) {
        return;
      }
      await self.registration.showNotification(title, {
        actions: notificationActionsForUrl(deepLink),
        badge: "/icons/favicon-32.png",
        body,
        data: {
          badgeCount,
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
      });
    })()
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
    return;
  }
  if (event.data?.type === "cop:pwa:warm-cache") {
    event.waitUntil(
      warmAppShellAssets()
        .then((assetUrls) => readPwaCacheState(assetUrls.length))
        .then((state) => notifyClient(event.source, { type: "cop:pwa:cache-warmed", ...state }))
        .catch((error) =>
          notifyClient(event.source, {
            message: error instanceof Error ? error.message : "PWA cache warm-up failed.",
            type: "cop:pwa:cache-warm-failed"
          })
        )
    );
    return;
  }
  if (event.data?.type === "cop:pwa:warm-route-tiles") {
    const routeId = typeof event.data.routeId === "string" ? event.data.routeId : "";
    const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
    event.waitUntil(
      warmRouteTileCache(routeId, urls, event.source).catch((error) =>
        notifyClient(event.source, {
          message: error instanceof Error ? error.message : "Route tile cache warm-up failed.",
          routeId,
          type: "cop:pwa:route-cache-failed"
        })
      )
    );
    return;
  }
  if (event.data?.type === "cop:pwa:cache-status") {
    event.waitUntil(
      readPwaCacheState()
        .then((state) => notifyClient(event.source, { type: "cop:pwa:cache-status", ...state }))
        .catch(() => undefined)
    );
    return;
  }
  if (event.data?.type === "cop:pwa:set-badge") {
    event.waitUntil(updateAppBadge(event.data.count));
  }
});

async function staleWhileRevalidateAppShell(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cacheKey = appShellCacheKeyForRequest(request);
  const cached = await cache.match(cacheKey);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(cacheKey, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    return cached;
  }

  return (await refresh) || Response.error();
}

async function networkFirstRuntime(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) {
      await cache.put(request, response.clone());
      await trimCache(cache, maxEntries);
    }
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
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

async function routeCacheFirst(request) {
  const routeCache = await caches.open(ROUTE_TILE_CACHE);
  const cachedRouteTile = await routeCache.match(request);
  if (cachedRouteTile) {
    if (cachedRouteTile.ok && cachedRouteTile.type !== "opaque") {
      return cachedRouteTile;
    }
    await routeCache.delete(request);
  }
  return cacheFirst(request, TILE_CACHE, MAX_TILE_ENTRIES);
}

async function warmAppShellAssets() {
  const shellCache = await caches.open(APP_SHELL_CACHE);
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  const assetUrls = await collectAppShellAssetUrls(shellCache);
  await Promise.all(assetUrls.map((url) => runtimeCache.add(url).catch(() => undefined)));
  await trimCache(runtimeCache, MAX_RUNTIME_ENTRIES);
  return assetUrls;
}

async function warmRouteTileCache(routeId, urls, client) {
  const normalizedRouteId = routeId.trim();
  if (!normalizedRouteId) {
    throw new Error("Route cache request is missing routeId.");
  }

  const normalizedUrls = normalizeRouteTileUrls(urls);
  const total = normalizedUrls.length;
  await notifyClient(client, {
    cached: 0,
    failed: 0,
    routeId: normalizedRouteId,
    total,
    type: "cop:pwa:route-cache-started"
  });
  if (total === 0) {
    await notifyClient(client, {
      cached: 0,
      failed: 0,
      routeId: normalizedRouteId,
      total,
      type: "cop:pwa:route-cache-warmed",
      updatedAt: new Date().toISOString()
    });
    return;
  }

  const cache = await caches.open(ROUTE_TILE_CACHE);
  let cached = 0;
  let failed = 0;

  for (const [index, url] of normalizedUrls.entries()) {
    try {
      const request = new Request(url, { credentials: "omit", mode: "cors" });
      const response = await fetch(request);
      if (response && response.ok && response.type !== "opaque") {
        await cache.put(request, response.clone());
        cached += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }

    if ((index + 1) % 25 === 0 || index + 1 === total) {
      await notifyClient(client, {
        cached,
        failed,
        routeId: normalizedRouteId,
        total,
        type: "cop:pwa:route-cache-progress"
      });
    }
  }

  await trimCache(cache, MAX_ROUTE_TILE_ENTRIES);
  await notifyClient(client, {
    cached,
    failed,
    routeId: normalizedRouteId,
    total,
    type: "cop:pwa:route-cache-warmed",
    updatedAt: new Date().toISOString()
  });
}

function normalizeRouteTileUrls(value) {
  const urls = new Set();
  for (const candidate of value) {
    if (urls.size >= MAX_ROUTE_TILE_WARMUP_URLS) {
      break;
    }
    if (typeof candidate !== "string" || !candidate.trim()) {
      continue;
    }
    try {
      const url = new URL(candidate, self.location.origin);
      if (url.protocol !== "https:" && url.origin !== self.location.origin) {
        continue;
      }
      if (MAP_RESOURCE_HOSTS.has(url.hostname) || isMapTileRequest(new Request(url.href), url)) {
        urls.add(url.href);
      }
    } catch {
      // Ignore malformed route cache candidates.
    }
  }
  return Array.from(urls);
}

async function collectAppShellAssetUrls(shellCache) {
  const assetUrls = new Set();
  await Promise.all(
    ["/index.html", "/chat/"].map(async (shellUrl) => {
      const response = await shellCache.match(shellUrl);
      if (!response || !response.ok) {
        return;
      }
      const html = await response.clone().text();
      for (const assetUrl of extractSameOriginAssetUrls(html, shellUrl)) {
        assetUrls.add(assetUrl);
      }
    })
  );
  return Array.from(assetUrls).slice(0, MAX_WARMED_APP_SHELL_ASSETS);
}

function extractSameOriginAssetUrls(html, basePath = "/") {
  const baseUrl = new URL(basePath, self.location.origin);
  const assetUrls = new Set();
  APP_SHELL_ASSET_ATTRIBUTE_PATTERN.lastIndex = 0;

  for (const match of html.matchAll(APP_SHELL_ASSET_ATTRIBUTE_PATTERN)) {
    const rawValue = match[1]?.trim();
    if (!rawValue) {
      continue;
    }

    let assetUrl;
    try {
      assetUrl = new URL(rawValue, baseUrl);
    } catch {
      continue;
    }
    if (assetUrl.origin !== self.location.origin) {
      continue;
    }

    const request = new Request(assetUrl.href);
    if (isImmutableRuntimeAssetRequest(request, assetUrl) || isAppAssetRequest(request, assetUrl)) {
      assetUrls.add(`${assetUrl.pathname}${assetUrl.search}`);
    }
  }

  return Array.from(assetUrls);
}

async function readPwaCacheState(warmedAssets = 0) {
  const [shellCache, runtimeCache, tileCache, routeTileCache] = await Promise.all([
    caches.open(APP_SHELL_CACHE),
    caches.open(RUNTIME_CACHE),
    caches.open(TILE_CACHE),
    caches.open(ROUTE_TILE_CACHE)
  ]);
  const [shellKeys, runtimeKeys, tileKeys, routeTileKeys] = await Promise.all([
    shellCache.keys(),
    runtimeCache.keys(),
    tileCache.keys(),
    routeTileCache.keys()
  ]);
  return {
    appShellEntries: shellKeys.length,
    routeTileEntries: routeTileKeys.length,
    runtimeEntries: runtimeKeys.length,
    tileEntries: tileKeys.length,
    updatedAt: new Date().toISOString(),
    warmedAssets
  };
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

function appShellCacheKeyForRequest(request) {
  const url = new URL(request.url);
  return isChatRequestPath(url.pathname) ? "/chat/" : "/index.html";
}

function isImmutableRuntimeAssetRequest(request, url) {
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/chat/assets/")) {
    return true;
  }
  if (url.pathname.startsWith("/icons/")) {
    return true;
  }
  return ["image", "font"].includes(request.destination) && url.origin === self.location.origin;
}

function isAppAssetRequest(request, url) {
  if (url.pathname === "/cop-service-worker.js" || url.pathname === "/site.webmanifest") {
    return true;
  }
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/chat/assets/") ||
    url.pathname.startsWith("/icons/")
  ) {
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

async function notifyClient(client, message) {
  if (client && "postMessage" in client) {
    client.postMessage(message);
    return;
  }
  await notifyClients(message);
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
  if (typeof payload.conversation_id === "string" && payload.conversation_id.trim()) {
    return `/chat/${encodeURIComponent(payload.conversation_id.trim())}`;
  }
  if (typeof payload.roomId === "string" && payload.roomId.trim()) {
    return `/chat/${encodeURIComponent(payload.roomId.trim())}`;
  }
  if (typeof payload.room_id === "string" && payload.room_id.trim()) {
    return `/chat/${encodeURIComponent(payload.room_id.trim())}`;
  }
  if (typeof payload.notification?.room_id === "string" && payload.notification.room_id.trim()) {
    return `/chat/${encodeURIComponent(payload.notification.room_id.trim())}`;
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

function notificationPayloadBadgeCount(payload) {
  const candidates = [
    payload?.badgeCount,
    payload?.badge_count,
    payload?.unreadCount,
    payload?.unread_count,
    payload?.unread,
    payload?.count,
    payload?.counts?.unread,
    payload?.notification?.counts?.unread,
    payload?.data?.badgeCount,
    payload?.data?.badge_count,
    payload?.data?.unreadCount,
    payload?.data?.unread_count,
    payload?.data?.unread,
    payload?.data?.count,
    payload?.data?.counts?.unread,
    payload?.data?.notification?.counts?.unread
  ];
  for (const candidate of candidates) {
    const normalized = Number(candidate);
    if (Number.isFinite(normalized) && normalized >= 0) {
      return Math.min(Math.trunc(normalized), 99);
    }
  }
  return 1;
}

async function updateAppBadge(count) {
  const normalized = Number.isFinite(Number(count)) ? Math.max(0, Math.trunc(Number(count))) : 0;
  try {
    if (normalized <= 0) {
      if (typeof self.registration.clearAppBadge === "function") {
        await self.registration.clearAppBadge();
        return;
      }
      if (typeof self.registration.setAppBadge === "function") {
        await self.registration.setAppBadge(0);
        return;
      }
      if (typeof navigator !== "undefined" && typeof navigator.clearAppBadge === "function") {
        await navigator.clearAppBadge();
        return;
      }
      if (typeof navigator !== "undefined" && typeof navigator.setAppBadge === "function") {
        await navigator.setAppBadge(0);
      }
      return;
    }
    if (typeof self.registration.setAppBadge === "function") {
      await self.registration.setAppBadge(normalized);
      return;
    }
    if (typeof navigator !== "undefined" && typeof navigator.setAppBadge === "function") {
      await navigator.setAppBadge(normalized);
    }
  } catch {
    // Badging is best-effort and not available in every PWA container.
  }
}

function notificationPayloadTag(payload) {
  const explicitTag = firstString(payload?.tag, payload?.data?.tag);
  const type = notificationPayloadType(payload);
  const eventId = firstString(
    payload?.eventId,
    payload?.event_id,
    payload?.messageId,
    payload?.message_id,
    payload?.matrixEventId,
    payload?.matrix_event_id,
    payload?.notification?.event_id,
    payload?.data?.eventId,
    payload?.data?.event_id,
    payload?.data?.messageId,
    payload?.data?.message_id,
    payload?.data?.matrixEventId,
    payload?.data?.matrix_event_id,
    payload?.data?.notification?.event_id
  );
  const scope = firstString(
    payload?.roomId,
    payload?.room_id,
    payload?.conversationId,
    payload?.conversation_id,
    payload?.notification?.room_id,
    payload?.data?.roomId,
    payload?.data?.room_id,
    payload?.data?.conversationId,
    payload?.data?.conversation_id,
    payload?.data?.notification?.room_id
  );
  if (eventId && (type === "chat.message" || type === "message" || scope)) {
    return `cop-chat-${safeNotificationTagPart(scope ?? "message")}-${safeNotificationTagPart(eventId)}`;
  }
  return explicitTag;
}

async function shouldSuppressDuplicateNotification(tag) {
  if (!tag) {
    pruneRecentNotificationTags();
    return false;
  }
  const now = Date.now();
  const previousAt = recentNotificationTags.get(tag);
  recentNotificationTags.set(tag, now);
  pruneRecentNotificationTags(now);
  if (previousAt && now - previousAt < RECENT_NOTIFICATION_TAG_TTL_MS) {
    return true;
  }
  if (typeof self.registration.getNotifications === "function") {
    try {
      const existing = await self.registration.getNotifications({ tag });
      return existing.length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

function pruneRecentNotificationTags(now = Date.now()) {
  for (const [tag, observedAt] of recentNotificationTags) {
    if (now - observedAt > RECENT_NOTIFICATION_TAG_TTL_MS) {
      recentNotificationTags.delete(tag);
    }
  }
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface ServiceWorkerContext {
  appShellCacheKeyForRequest: (request: Request) => string;
  extractManifestAssetUrls: (manifest: unknown, basePath?: string) => string[];
  extractSameOriginAssetUrls: (html: string, basePath?: string) => string[];
  fetchAndCacheWithRetry: (
    cache: MockServiceWorkerCache,
    url: string,
    options?: { attempts?: number; retryBaseMs?: number }
  ) => Promise<Response>;
  isAppAssetRequest: (request: Request, url: URL) => boolean;
  isChatRequestPath: (pathname: string) => boolean;
  isImmutableRuntimeAssetRequest: (request: Request, url: URL) => boolean;
  networkFirstAppShell: (
    request: Request,
    event?: { waitUntil: (promise: Promise<unknown>) => void }
  ) => Promise<Response>;
  refreshAppShellCache: (options?: {
    includeOptional?: boolean;
    retryBaseMs?: number;
    strict?: boolean;
  }) => Promise<number>;
  releaseCacheKeysToDelete: (keys: string[]) => string[];
  warmAppShellAssets: (options?: { refreshShell?: boolean; strict?: boolean }) => Promise<string[]>;
  notificationActionsForPayload: (
    payload: Record<string, unknown>,
    url?: string
  ) => Array<{ action: string; title: string }>;
  notificationPayloadBadgeCount: (payload: Record<string, unknown>) => number | undefined;
  notificationPayloadDeepLink: (payload: Record<string, unknown>) => string;
  notificationPayloadTag: (payload: Record<string, unknown>) => string | undefined;
  notificationRequiresInteraction: (payload: Record<string, unknown>, severity: string) => boolean;
  self: {
    registration: {
      clearAppBadge: ReturnType<typeof vi.fn>;
      getNotifications: ReturnType<typeof vi.fn>;
      setAppBadge: ReturnType<typeof vi.fn>;
      showNotification: ReturnType<typeof vi.fn>;
    };
  };
  shouldSuppressDuplicateNotification: (tag?: string) => Promise<boolean>;
  updateAppBadge: (count?: number) => Promise<void>;
}

interface MockServiceWorkerCache {
  delete: ReturnType<typeof vi.fn>;
  entries: Map<string, Response>;
  keys: ReturnType<typeof vi.fn>;
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function loadServiceWorkerContext(
  options: {
    existingNotifications?: Array<{ tag?: string }>;
    fetch?: ReturnType<typeof vi.fn>;
    shellCache?: MockServiceWorkerCache;
  } = {}
): ServiceWorkerContext {
  const source = readFileSync(resolve("apps/cop-web/public/cop-service-worker.js"), "utf8");
  const clearAppBadge = vi.fn(async () => undefined);
  const getNotifications = vi.fn(async ({ tag }: { tag?: string } = {}) =>
    (options.existingNotifications ?? []).filter((notification) => !tag || notification.tag === tag)
  );
  const setAppBadge = vi.fn(async () => undefined);
  const showNotification = vi.fn(async () => undefined);
  const shellCache = options.shellCache ?? createMockCache();
  const context = {
    Request,
    Response,
    URL,
    caches: {
      open: vi.fn(async () => shellCache)
    },
    clearTimeout,
    console,
    fetch: options.fetch ?? vi.fn(),
    self: {
      clients: {},
      location: { origin: "https://cop.example.test" },
      addEventListener: vi.fn(),
      registration: {
        clearAppBadge,
        getNotifications,
        setAppBadge,
        showNotification
      }
    },
    setTimeout
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context as unknown as ServiceWorkerContext;
}

function createMockCache(initialEntries: Record<string, Response> = {}): MockServiceWorkerCache {
  const entries = new Map(Object.entries(initialEntries));
  return {
    delete: vi.fn(async (request: Request | string) => entries.delete(cacheRequestKey(request))),
    entries,
    keys: vi.fn(async () =>
      Array.from(entries.keys()).map((key) => new Request(new URL(key, "https://cop.example.test").href))
    ),
    match: vi.fn(async (request: Request | string) => entries.get(cacheRequestKey(request))?.clone()),
    put: vi.fn(async (request: Request | string, response: Response) => {
      entries.set(cacheRequestKey(request), response.clone());
    })
  };
}

function cacheRequestKey(request: Request | string): string {
  if (typeof request === "string") {
    return request;
  }
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

describe("COP PWA service worker routing", () => {
  it("uses cached shell keys for main and chat navigations", () => {
    const serviceWorker = loadServiceWorkerContext();

    expect(serviceWorker.appShellCacheKeyForRequest(new Request("https://cop.example.test/"))).toBe("/index.html");
    expect(serviceWorker.appShellCacheKeyForRequest(new Request("https://cop.example.test/map?x=1"))).toBe(
      "/index.html"
    );
    expect(serviceWorker.appShellCacheKeyForRequest(new Request("https://cop.example.test/chat/?embedded=1"))).toBe(
      "/chat/"
    );
    expect(serviceWorker.appShellCacheKeyForRequest(new Request("https://cop.example.test/chat/!room"))).toBe("/chat/");
  });

  it("treats chat build chunks as immutable runtime assets", () => {
    const serviceWorker = loadServiceWorkerContext();
    const request = new Request("https://cop.example.test/chat/assets/index-abc123.js");
    const url = new URL(request.url);

    expect(serviceWorker.isChatRequestPath("/chat/")).toBe(true);
    expect(serviceWorker.isImmutableRuntimeAssetRequest(request, url)).toBe(true);
    expect(serviceWorker.isAppAssetRequest(request, url)).toBe(true);
  });

  it("extracts only same-origin shell assets for runtime cache warming", () => {
    const serviceWorker = loadServiceWorkerContext();
    const html = `
      <script type="module" src="/assets/index-main.js"></script>
      <link rel="modulepreload" href="assets/chat-entry.js">
      <link rel="stylesheet" href="/chat/assets/index.css?v=1">
      <link rel="manifest" href="/site.webmanifest">
      <script src="https://cdn.example.test/external.js"></script>
      <a href="/api/v1/sources">sources</a>
    `;

    expect(serviceWorker.extractSameOriginAssetUrls(html, "/chat/")).toEqual([
      "/assets/index-main.js",
      "/chat/assets/chat-entry.js",
      "/chat/assets/index.css?v=1",
      "/site.webmanifest"
    ]);
  });

  it("warms only entry assets from web and chat build manifests", () => {
    const serviceWorker = loadServiceWorkerContext();
    const manifest = {
      "index.html": {
        css: ["assets/index.css"],
        dynamicImports: ["src/CopMap.tsx"],
        file: "assets/index.js",
        imports: ["_vendor.js"],
        isEntry: true
      },
      "_vendor.js": {
        file: "assets/vendor.js",
        imports: ["_runtime.js"]
      },
      "_runtime.js": {
        file: "assets/runtime.js"
      },
      "src/CopMap.tsx": {
        assets: ["assets/map-marker.png"],
        file: "assets/CopMap.js"
      }
    };

    expect(serviceWorker.extractManifestAssetUrls(manifest, "/chat/")).toEqual([
      "/chat/assets/index.js",
      "/chat/assets/index.css",
      "/chat/assets/vendor.js",
      "/chat/assets/runtime.js"
    ]);
  });

  it("keeps the current and immediately previous PWA release caches", () => {
    const serviceWorker = loadServiceWorkerContext();
    const keys = [
      "cop-pwa-offline-20260712-1:shell",
      "cop-pwa-offline-20260712-1:runtime",
      "cop-pwa-offline-20260711-20:shell",
      "cop-pwa-offline-20260711-20:runtime",
      "cop-pwa-offline-20260711-19:shell",
      "cop-pwa-offline-20260711-19:runtime",
      "cop-pwa-offline-20260710-18:shell",
      "cop-pwa-offline-20260710-18:runtime",
      "cop-pwa-offline-20260710-17:shell",
      "cop-pwa-offline-20260710-17:runtime",
      "cop-pwa-offline-20260710-15:shell",
      "cop-pwa-offline-20260710-15:runtime",
      "cop-pwa-offline-20260710-14:shell",
      "cop-pwa-offline-20260710-14:runtime",
      "cop-pwa-offline-20260710-13:shell",
      "cop-pwa-offline-20260710-13:runtime",
      "cop-pwa-offline-20260710-12:shell",
      "cop-pwa-offline-20260710-12:runtime",
      "cop-pwa-offline-20260710-11:shell",
      "cop-pwa-offline-20260710-11:runtime",
      "cop-pwa-offline-20260710-10:shell",
      "cop-pwa-offline-20260710-10:runtime",
      "cop-pwa-offline-20260710-9:shell",
      "cop-pwa-offline-20260710-9:runtime",
      "cop-pwa-offline-20260710-8:shell",
      "cop-pwa-offline-20260710-8:runtime",
      "cop-pwa-offline-20260710-7:shell",
      "cop-pwa-offline-20260710-7:runtime",
      "cop-pwa-offline-20260710-6:shell",
      "cop-pwa-offline-20260710-6:runtime",
      "cop-pwa-offline-20260710-5:shell",
      "cop-pwa-offline-20260710-5:runtime",
      "cop-pwa-offline-20260710-4:shell",
      "cop-pwa-offline-20260710-4:runtime",
      "cop-pwa-offline-20260710-3:shell",
      "cop-pwa-offline-20260710-3:runtime",
      "cop-pwa-offline-20260710-2:shell",
      "cop-pwa-offline-20260710-2:runtime",
      "cop-pwa-offline-20260710-1:shell",
      "cop-pwa-offline-20260710-1:runtime",
      "cop-pwa-offline-20260709-2:shell",
      "cop-pwa-offline-20260709-2:runtime",
      "cop-pwa-offline-20260709-1:shell",
      "cop-pwa-offline-20260709-1:runtime",
      "cop-pwa-offline-20260708-8:shell",
      "third-party-cache"
    ];

    expect(serviceWorker.releaseCacheKeysToDelete(keys)).toEqual([
      "cop-pwa-offline-20260711-19:shell",
      "cop-pwa-offline-20260711-19:runtime",
      "cop-pwa-offline-20260710-18:shell",
      "cop-pwa-offline-20260710-18:runtime",
      "cop-pwa-offline-20260710-17:shell",
      "cop-pwa-offline-20260710-17:runtime",
      "cop-pwa-offline-20260710-15:shell",
      "cop-pwa-offline-20260710-15:runtime",
      "cop-pwa-offline-20260710-14:shell",
      "cop-pwa-offline-20260710-14:runtime",
      "cop-pwa-offline-20260710-13:shell",
      "cop-pwa-offline-20260710-13:runtime",
      "cop-pwa-offline-20260710-12:shell",
      "cop-pwa-offline-20260710-12:runtime",
      "cop-pwa-offline-20260710-11:shell",
      "cop-pwa-offline-20260710-11:runtime",
      "cop-pwa-offline-20260710-10:shell",
      "cop-pwa-offline-20260710-10:runtime",
      "cop-pwa-offline-20260710-9:shell",
      "cop-pwa-offline-20260710-9:runtime",
      "cop-pwa-offline-20260710-8:shell",
      "cop-pwa-offline-20260710-8:runtime",
      "cop-pwa-offline-20260710-7:shell",
      "cop-pwa-offline-20260710-7:runtime",
      "cop-pwa-offline-20260710-6:shell",
      "cop-pwa-offline-20260710-6:runtime",
      "cop-pwa-offline-20260710-5:shell",
      "cop-pwa-offline-20260710-5:runtime",
      "cop-pwa-offline-20260710-4:shell",
      "cop-pwa-offline-20260710-4:runtime",
      "cop-pwa-offline-20260710-3:shell",
      "cop-pwa-offline-20260710-3:runtime",
      "cop-pwa-offline-20260710-2:shell",
      "cop-pwa-offline-20260710-2:runtime",
      "cop-pwa-offline-20260710-1:shell",
      "cop-pwa-offline-20260710-1:runtime",
      "cop-pwa-offline-20260709-2:shell",
      "cop-pwa-offline-20260709-2:runtime",
      "cop-pwa-offline-20260709-1:shell",
      "cop-pwa-offline-20260709-1:runtime",
      "cop-pwa-offline-20260708-8:shell"
    ]);
  });

  it("prefers a fresh network app shell for online chat navigations", async () => {
    const shellCache = createMockCache({ "/chat/": new Response("cached chat shell", { status: 200 }) });
    const fetch = vi.fn(async () => new Response("fresh chat shell", { status: 200 }));
    const serviceWorker = loadServiceWorkerContext({ fetch, shellCache });

    const response = await serviceWorker.networkFirstAppShell(new Request("https://cop.example.test/chat/"));

    await expect(response.text()).resolves.toBe("fresh chat shell");
    expect(fetch).toHaveBeenCalledWith(expect.any(Request), { cache: "no-cache" });
    expect(shellCache.put).toHaveBeenCalledWith("/chat/", expect.any(Response));
    await expect(shellCache.entries.get("/chat/")?.text()).resolves.toBe("fresh chat shell");
  });

  it("falls back to the cached app shell when chat navigation is offline", async () => {
    const shellCache = createMockCache({ "/chat/": new Response("offline chat shell", { status: 200 }) });
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const serviceWorker = loadServiceWorkerContext({ fetch, shellCache });

    const response = await serviceWorker.networkFirstAppShell(new Request("https://cop.example.test/chat/"));

    await expect(response.text()).resolves.toBe("offline chat shell");
  });

  it("retries a transient critical shell request before caching it", async () => {
    const shellCache = createMockCache();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(new Response("fresh chat shell", { status: 200 }));
    const serviceWorker = loadServiceWorkerContext({ fetch, shellCache });

    await expect(
      serviceWorker.fetchAndCacheWithRetry(shellCache, "/chat/", { attempts: 3, retryBaseMs: 0 })
    ).resolves.toBeInstanceOf(Response);

    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(shellCache.entries.get("/chat/")?.text()).resolves.toBe("fresh chat shell");
  });

  it("does not abort a strict shell refresh when an optional icon is unavailable", async () => {
    const shellCache = createMockCache();
    const fetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/icons/favicon-32.png") {
        return new Response("missing", { status: 503 });
      }
      return new Response(pathname, { status: 200 });
    });
    const serviceWorker = loadServiceWorkerContext({ fetch, shellCache });

    await expect(serviceWorker.refreshAppShellCache({ retryBaseMs: 0, strict: true })).resolves.toBe(4);

    expect(shellCache.entries.has("/index.html")).toBe(true);
    expect(shellCache.entries.has("/chat/")).toBe(true);
    expect(shellCache.entries.has("/icons/favicon-32.png")).toBe(false);
  });

  it("refreshes stale chat HTML and its manifest before warming entry assets", async () => {
    const shellCache = createMockCache({
      "/chat/": new Response('<link rel="stylesheet" href="/chat/assets/old.css">', { status: 200 }),
      "/chat/asset-manifest.json": new Response(
        JSON.stringify({ "index.html": { file: "assets/old.js", isEntry: true } }),
        { status: 200 }
      )
    });
    const fetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/chat/") {
        return new Response('<link rel="stylesheet" href="/chat/assets/new.css">', { status: 200 });
      }
      if (pathname === "/chat/asset-manifest.json") {
        return new Response(JSON.stringify({ "index.html": { file: "assets/new.js", isEntry: true } }), {
          status: 200
        });
      }
      if (pathname === "/index.html") {
        return new Response('<script type="module" src="/assets/web.js"></script>', { status: 200 });
      }
      if (pathname === "/asset-manifest.json") {
        return new Response(JSON.stringify({ "index.html": { file: "assets/web.js", isEntry: true } }), {
          status: 200
        });
      }
      return new Response(pathname, { status: 200 });
    });
    const serviceWorker = loadServiceWorkerContext({ fetch, shellCache });

    const warmed = await serviceWorker.warmAppShellAssets();

    expect(warmed).toContain("/chat/assets/new.css");
    expect(warmed).toContain("/chat/assets/new.js");
    expect(warmed).not.toContain("/chat/assets/old.css");
    expect(warmed).not.toContain("/chat/assets/old.js");
    await expect(shellCache.entries.get("/chat/")?.text()).resolves.toContain("new.css");
  });

  it("keeps a slow shell refresh alive after returning the cached navigation", async () => {
    vi.useFakeTimers();
    try {
      const shellCache = createMockCache({ "/chat/": new Response("cached chat shell", { status: 200 }) });
      let resolveFetch: ((response: Response) => void) | undefined;
      const fetch = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      );
      const serviceWorker = loadServiceWorkerContext({ fetch, shellCache });
      const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();

      const responsePromise = serviceWorker.networkFirstAppShell(new Request("https://cop.example.test/chat/"), {
        waitUntil
      });
      await vi.advanceTimersByTimeAsync(2_500);
      const response = await responsePromise;

      await expect(response.text()).resolves.toBe("cached chat shell");
      expect(waitUntil).toHaveBeenCalledTimes(1);

      resolveFetch?.(new Response("fresh chat shell", { status: 200 }));
      await waitUntil.mock.calls[0]?.[0];
      await expect(shellCache.entries.get("/chat/")?.text()).resolves.toBe("fresh chat shell");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("COP PWA service worker notifications", () => {
  it("deduplicates raw Matrix push payloads by room and event", () => {
    const serviceWorker = loadServiceWorkerContext();

    expect(
      serviceWorker.notificationPayloadTag({
        notification: {
          event_id: "$event-1",
          room_id: "!room:cop.local",
          type: "m.room.encrypted"
        }
      })
    ).toBe("cop-chat-!room:cop.local-$event-1");
  });

  it("builds urgent tags and actions for incoming voice calls", () => {
    const serviceWorker = loadServiceWorkerContext();
    const payload = {
      callId: "call-1",
      data: {
        deepLink: "csm://chat/room/%21ops%3Amsg.zeleznalady.cz",
        type: "chat.voice_call.incoming"
      },
      roomId: "!ops:msg.zeleznalady.cz"
    };

    expect(serviceWorker.notificationPayloadTag(payload)).toBe("cop-call:!ops:msg.zeleznalady.cz:call-1");
    expect(serviceWorker.notificationPayloadDeepLink(payload)).toBe("/chat/!ops%3Amsg.zeleznalady.cz");
    expect(serviceWorker.notificationActionsForPayload(payload, "/chat/!ops")).toEqual([
      { action: "open-call", title: "Otevřít hovor" },
      { action: "dismiss", title: "Zavřít" }
    ]);
    expect(serviceWorker.notificationRequiresInteraction(payload, "info")).toBe(true);
  });

  it("reads zero unread counts from Matrix push payloads", () => {
    const serviceWorker = loadServiceWorkerContext();

    expect(
      serviceWorker.notificationPayloadBadgeCount({
        notification: {
          counts: {
            unread: 0
          }
        }
      })
    ).toBe(0);
  });

  it("clears the app badge when unread count reaches zero", async () => {
    const serviceWorker = loadServiceWorkerContext();
    const registration = serviceWorker.self.registration;

    await serviceWorker.updateAppBadge(0);

    expect(registration.clearAppBadge).toHaveBeenCalledTimes(1);
    expect(registration.setAppBadge).not.toHaveBeenCalled();
  });

  it("suppresses repeated notifications with the same tag", async () => {
    const serviceWorker = loadServiceWorkerContext();

    await expect(serviceWorker.shouldSuppressDuplicateNotification("cop-chat-!room-$event")).resolves.toBe(false);
    await expect(serviceWorker.shouldSuppressDuplicateNotification("cop-chat-!room-$event")).resolves.toBe(true);
  });

  it("suppresses notifications that are already visible for the same tag", async () => {
    const serviceWorker = loadServiceWorkerContext({
      existingNotifications: [{ tag: "cop-chat-!room-$event" }]
    });

    await expect(serviceWorker.shouldSuppressDuplicateNotification("cop-chat-!room-$event")).resolves.toBe(true);
  });
});

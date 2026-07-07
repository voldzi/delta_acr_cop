import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface ServiceWorkerContext {
  appShellCacheKeyForRequest: (request: Request) => string;
  extractSameOriginAssetUrls: (html: string, basePath?: string) => string[];
  isAppAssetRequest: (request: Request, url: URL) => boolean;
  isChatRequestPath: (pathname: string) => boolean;
  isImmutableRuntimeAssetRequest: (request: Request, url: URL) => boolean;
}

function loadServiceWorkerContext(): ServiceWorkerContext {
  const source = readFileSync(resolve("apps/cop-web/public/cop-service-worker.js"), "utf8");
  const context = {
    Request,
    Response,
    URL,
    caches: {},
    clearTimeout,
    console,
    fetch: vi.fn(),
    self: {
      clients: {},
      location: { origin: "https://cop.example.test" },
      addEventListener: vi.fn()
    },
    setTimeout
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context as unknown as ServiceWorkerContext;
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
});

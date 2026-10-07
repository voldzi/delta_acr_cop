import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http, { type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ResolvedConfig, ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cesiumAssetsPlugin } from "../cesium-assets-plugin";

let fixture: string;
let sourceRoot: string;
let server: Server;
let base: string;
const directories = ["Assets", "ThirdParty", "Widgets", "Workers"];
const plugin = cesiumAssetsPlugin;

type Middleware = (request: http.IncomingMessage, response: http.ServerResponse, next: () => void) => void;

beforeAll(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "cop-cesium-assets-"));
  sourceRoot = path.join(fixture, "source");
  for (const directory of directories) {
    await mkdir(path.join(sourceRoot, directory), { recursive: true });
    await writeFile(path.join(sourceRoot, directory, "fixture.js"), `export const directory = '${directory}';`);
  }
  await writeFile(path.join(fixture, "private.txt"), "PRIVATE_FIXTURE");
  await symlink(path.join(fixture, "private.txt"), path.join(sourceRoot, "Workers", "leak.js"));
  const runtimePlugin = plugin(sourceRoot);
  const resolved = runtimePlugin.configResolved;
  if (typeof resolved !== "function") throw new Error("Expected config hook.");
  await resolved.call({} as never, {
    root: fixture, command: "build", base: "/", build: { outDir: "dist" }
  } as ResolvedConfig);
  let middleware: Middleware | undefined;
  const configure = runtimePlugin.configureServer;
  if (typeof configure !== "function") throw new Error("Expected server hook.");
  configure.call({} as never, {
    middlewares: { use(handler: Middleware) { middleware = handler; } }
  } as unknown as ViteDevServer);
  server = http.createServer((request, response) => {
    middleware?.(request, response, () => { response.statusCode = 404; response.end("Other route"); });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address.");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

describe("fixed Cesium runtime assets", () => {
  it("copies all four runtime directories into the configured build output", async () => {
    const buildPlugin = plugin(sourceRoot);
    const resolved = buildPlugin.configResolved;
    const close = buildPlugin.closeBundle;
    if (typeof resolved !== "function" || typeof close !== "function") throw new Error("Expected build hooks.");
    await resolved.call({} as never, {
      root: fixture, command: "build", base: "/", build: { outDir: "dist" }
    } as ResolvedConfig);
    await close.call({} as never);
    for (const directory of directories) {
      expect(await readFile(path.join(fixture, "dist/cesium", directory, "fixture.js"), "utf8"))
        .toBe(`export const directory = '${directory}';`);
    }
  });
  it("serves worker/widget assets in development and supports HEAD", async () => {
    for (const directory of directories) {
      const result = await fetch(`${base}/cesium/${directory}/fixture.js`);
      expect(result.status).toBe(200);
      expect(result.headers.get("content-type")).toContain("javascript");
      expect(await result.text()).toContain(`'${directory}'`);
    }
    const head = await fetch(`${base}/cesium/Workers/fixture.js`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBeGreaterThan(0);
    expect(await head.text()).toBe("");
  });
  it("rejects traversal, unrecognized roots, invalid paths and symlink escapes", async () => {
    for (const relative of ["Workers/%2e%2e%2f%2e%2e%2fprivate.txt", "Unknown/fixture.js", "Workers/%00.js", "Workers/%ZZ"]) {
      const result = await fetch(`${base}/cesium/${relative}`);
      expect(result.status).toBe(400);
      expect(await result.text()).not.toContain("PRIVATE_FIXTURE");
    }
    const leak = await fetch(`${base}/cesium/Workers/leak.js`);
    expect(leak.status).toBe(404);
    expect(await leak.text()).not.toContain("PRIVATE_FIXTURE");
    expect((await fetch(`${base}/cesium/Workers/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/cesium/Workers/fixture.js`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/health/live`)).status).toBe(404);
  });
});

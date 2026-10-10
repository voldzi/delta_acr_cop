import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http, { type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtures: string[] = [];
const processes: ChildProcess[] = [];
const servers: Server[] = [];
let upstreamUrl: string;
let alternateUrl: string;
let alternateRequests = 0;
let oidcRequests = 0;
let upstreamClosed = 0;
let stalledRequests = 0;
const clients = new Map<string, string>();

async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function startApp(app: string): Promise<string> {
  const fixture = await mkdtemp(path.join(tmpdir(), `cop-${app}-server-`));
  fixtures.push(fixture);
  await mkdir(path.join(fixture, "dist/assets"), { recursive: true });
  await writeFile(path.join(fixture, "dist/index.html"), "<!doctype html><title>COP fixture</title>");
  await writeFile(path.join(fixture, "dist/assets/test.js"), "export const fixture = 'cop';\n".repeat(1_000));
  await writeFile(path.join(fixture, "private.txt"), "PRIVATE_FIXTURE_DO_NOT_SERVE");
  await symlink(path.join(fixture, "private.txt"), path.join(fixture, "dist/assets/leak.js"));
  // Accelerate the unchanged watchdog logic; production retains a 30 s limit.
  const source = (await readFile(path.join(appRoot, app, "server.mjs"), "utf8")).replace(
    "const upstreamTimeoutMs = 30_000;",
    "const upstreamTimeoutMs = 3_000;"
  );
  await writeFile(path.join(fixture, "server.mjs"), source);
  // Discover the listener's ephemeral port without reserving/racing a port.
  const portSource = source.replace("console.log(`COP ", "console.log(`PORT:${server.address().port} COP ");
  await writeFile(path.join(fixture, "server.mjs"), portSource);
  const running = spawn(process.execPath, [path.join(fixture, "server.mjs")], {
    env: {
      ...process.env,
      [app === "cop-web" ? "COP_WEB_PORT" : "COP_CHAT_PORT"]: "0",
      COP_API_BASE_URL: upstreamUrl,
      COP_OIDC_ISSUER: upstreamUrl,
      COP_CHAT_BASE_PATH: "/chat/"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  processes.push(running);
  const address = await new Promise<string>((resolve, reject) => {
    let output = "";
    const deadline = setTimeout(() => reject(new Error("Static server did not start.")), 30_000);
    running.stdout?.on("data", (chunk: Buffer) => {
      output += String(chunk);
      const match = /PORT:(\d+)/u.exec(output);
      if (match) {
        clearTimeout(deadline);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    running.once("exit", (code) => {
      clearTimeout(deadline);
      reject(new Error(`Static server exited: ${code}`));
    });
  });
  return address;
}

function rawRequest(
  base: string,
  target: string,
  options: {
    method?: string;
    headers?: http.OutgoingHttpHeaders;
    body?: string;
  } = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      base,
      {
        method: options.method ?? "GET",
        path: target,
        headers: options.headers
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            headers: response.headers
          })
        );
      }
    );
    request.once("error", reject);
    request.end(options.body);
  });
}

beforeAll(async () => {
  upstreamUrl = await listen(
    http.createServer((request, response) => {
      if (request.url === "/protocol/openid-connect/token") {
        oidcRequests += 1;
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          if (body === "hang") {
            response.once("close", () => {
              upstreamClosed += 1;
            });
            return;
          }
          if (body === "oversized") {
            response.end("x".repeat(300_000));
            return;
          }
          if (body === "redirect") {
            response.writeHead(307, { Location: `${alternateUrl}/capture-token` });
            response.end();
            return;
          }
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ access_token: "SYNTHETIC_TOKEN" }));
        });
        return;
      }
      if (request.url?.endsWith("?hang")) {
        stalledRequests += 1;
        response.once("close", () => {
          upstreamClosed += 1;
        });
        request.resume();
        return;
      }
      if (request.url?.endsWith("?reset")) {
        request.socket.destroy();
        return;
      }
      response.setHeader("Connection", "x-internal-response");
      response.setHeader("X-Internal-Response", "must-not-be-forwarded");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ path: request.url, headers: request.headers }));
    })
  );
  alternateUrl = await listen(
    http.createServer((_request, response) => {
      alternateRequests += 1;
      response.end("unexpected SSRF");
    })
  );
  for (const app of ["cop-web", "cop-chat"]) {
    clients.set(app, await startApp(app));
  }
}, 90_000);

afterAll(async () => {
  for (const child of processes) {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
  await Promise.all(fixtures.map((fixture) => rm(fixture, { recursive: true, force: true })));
});

for (const app of ["cop-web", "cop-chat"]) {
  describe(`${app} production HTTP boundary`, () => {
    const staticPath = (relative: string) => `${app === "cop-chat" ? "/chat" : ""}/${relative}`;
    it("rejects client-selected absolute and network-path proxy authorities", async () => {
      const base = clients.get(app)!;
      expect((await rawRequest(base, `${alternateUrl}/_matrix/push/v1/notify`)).status).toBe(400);
      expect((await rawRequest(base, `//${new URL(alternateUrl).host}/_matrix/push/v1/notify`)).status).toBe(400);
      expect(alternateRequests).toBe(0);
    });
    it("relays only the configured API and strips connection-nominated headers", async () => {
      const result = await rawRequest(clients.get(app)!, "/_matrix/push/v1/notify?fixture", {
        method: "POST",
        body: "{}",
        headers: { Connection: "x-internal-request", "X-Internal-Request": "private-hop" }
      });
      expect(result.status).toBe(200);
      expect(JSON.parse(result.body).path).toBe("/_matrix/push/v1/notify?fixture");
      expect(JSON.parse(result.body).headers["x-internal-request"]).toBeUndefined();
      expect(result.headers["x-internal-response"]).toBeUndefined();
    });
    it("returns a bounded timeout and gateway failure while remaining healthy", async () => {
      const base = clients.get(app)!;
      expect((await rawRequest(base, "/_matrix/push/v1/notify?hang")).status).toBe(504);
      expect((await rawRequest(base, "/_matrix/push/v1/notify?reset")).status).toBe(502);
      expect((await rawRequest(base, "/health/live")).status).toBe(200);
    }, 10_000);
    it("cancels the upstream when the client disconnects", async () => {
      const before = upstreamClosed;
      const acceptedBefore = stalledRequests;
      const client = http.request(clients.get(app)!, { path: "/_matrix/push/v1/notify?hang" });
      client.on("error", () => undefined);
      client.end();
      const deadline = Date.now() + 1_000;
      while (stalledRequests === acceptedBefore && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(stalledRequests).toBeGreaterThan(acceptedBefore);
      client.destroy();
      const closeDeadline = Date.now() + 1_000;
      while (upstreamClosed === before && Date.now() < closeDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(upstreamClosed).toBeGreaterThan(before);
    });
    it("rejects traversal, malformed encoding and NUL without reading outside dist", async () => {
      const base = clients.get(app)!;
      for (const target of ["%2e%2e%2fprivate.txt", "%ZZ", "%00.js"]) {
        expect((await rawRequest(base, staticPath(target))).status).toBe(400);
      }
      const symlinkResult = await rawRequest(base, staticPath("assets/leak.js"));
      expect(symlinkResult.status).toBe(404);
      expect(symlinkResult.body).not.toContain("PRIVATE_FIXTURE");
    });
    it("honors disabled encodings and keeps immutable assets and SPA fallback", async () => {
      const base = clients.get(app)!;
      const asset = await rawRequest(base, staticPath("assets/test.js"), {
        headers: { "Accept-Encoding": "br;q=0, gzip;q=0" }
      });
      expect(asset.status).toBe(200);
      expect(asset.body).toContain("export const fixture");
      expect(asset.headers["content-encoding"]).toBeUndefined();
      expect(asset.headers["cache-control"]).toContain("immutable");
      const gzip = await rawRequest(base, staticPath("assets/test.js"), {
        method: "HEAD",
        headers: { "Accept-Encoding": "br;q=0.1, gzip;q=0.9" }
      });
      expect(gzip.headers["content-encoding"]).toBe("gzip");
      const br = await rawRequest(base, staticPath("assets/test.js"), {
        method: "HEAD",
        headers: { "Accept-Encoding": "br, gzip" }
      });
      expect(br.headers["content-encoding"]).toBe("br");
      const fallback = await rawRequest(base, staticPath(app === "cop-web" ? "globe" : "conversation"));
      expect(fallback.status).toBe(200);
      expect(fallback.headers["cache-control"]).toBe("no-cache");
      expect(fallback.body).toContain("COP fixture");
      if (app === "cop-web") {
        const unknown = await rawRequest(base, staticPath("conversation"));
        expect(unknown.status).toBe(404);
        expect(unknown.body).not.toContain("COP fixture");
      }
    });
  });
}

describe("COP chat OIDC proxy", () => {
  it("bounds token request and response sizes without exposing tokens in an error", async () => {
    const before = oidcRequests;
    const request = await rawRequest(clients.get("cop-chat")!, "/chat/oidc/token", {
      method: "POST",
      body: "x".repeat(65_537)
    });
    expect(request.status).toBe(413);
    expect(request.headers["cache-control"]).toBe("no-store");
    expect(oidcRequests).toBe(before);
    const response = await rawRequest(clients.get("cop-chat")!, "/chat/oidc/token", {
      method: "POST",
      body: "oversized"
    });
    expect(response.status).toBe(502);
    expect(response.body).toBe('{"error":"oidc_upstream_unavailable"}');
  });
  it("does not forward token POST data when the issuer redirects to another origin", async () => {
    const result = await rawRequest(clients.get("cop-chat")!, "/chat/oidc/token", {
      method: "POST",
      body: "redirect"
    });
    expect(result.status).toBe(502);
    expect(result.body).toBe('{"error":"oidc_upstream_unavailable"}');
    expect(alternateRequests).toBe(0);
  });
  it("cancels a stalled issuer and still relays a valid synthetic response", async () => {
    const before = upstreamClosed;
    const timeout = await rawRequest(clients.get("cop-chat")!, "/chat/oidc/token", {
      method: "POST",
      body: "hang"
    });
    expect(timeout.status).toBe(504);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(upstreamClosed).toBeGreaterThan(before);
    const valid = await rawRequest(clients.get("cop-chat")!, "/chat/oidc/token", {
      method: "POST",
      body: "valid",
      headers: { Origin: clients.get("cop-chat")! }
    });
    expect(valid.status).toBe(200);
    expect(valid.headers["cache-control"]).toBe("no-store");
    expect(valid.headers["access-control-allow-origin"]).toBe(clients.get("cop-chat"));
    expect(JSON.parse(valid.body).access_token).toBe("SYNTHETIC_TOKEN");
  }, 10_000);
});

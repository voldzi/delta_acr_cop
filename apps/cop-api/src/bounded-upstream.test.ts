import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBoundedProxyResource, readBoundedBody, UpstreamBodyTooLargeError } from "./bounded-upstream.js";

const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function serve(handler: RequestListener): Promise<URL> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener.");
  return new URL(`http://127.0.0.1:${address.port}`);
}

describe("bounded allowlisted upstream resource", () => {
  it("refuses a redirect before sending any request to the unapproved target", async () => {
    let forbiddenRequests = 0;
    const forbidden = await serve((_request, response) => {
      forbiddenRequests += 1;
      response.end("private");
    });
    const allowed = await serve((_request, response) => {
      response.writeHead(302, { location: `${forbidden}private.png` });
      response.end();
    });
    await expect(fetchBoundedProxyResource(new URL("radar.png", allowed), {
      headers: {}, isAllowedUrl: (url) => url.origin === allowed.origin, maxBytes: 1024, timeoutMs: 1000
    })).rejects.toThrow("destination is not allowed");
    expect(forbiddenRequests).toBe(0);
  });

  it("preserves a valid relative redirect on the approved source", async () => {
    const allowed = await serve((request, response) => {
      if (request.url === "/old.png") response.writeHead(302, { location: "/new.png" }).end();
      else response.writeHead(200, { "content-type": "image/png" }).end("image");
    });
    const response = await fetchBoundedProxyResource(new URL("old.png", allowed), {
      headers: {}, isAllowedUrl: (url) => url.origin === allowed.origin, maxBytes: 1024, timeoutMs: 1000
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("image");
  });

  it("bounds redirect loops", async () => {
    let count = 0;
    const allowed = await serve((_request, response) => {
      count += 1;
      response.writeHead(302, { location: "/loop.png" }).end();
    });
    await expect(fetchBoundedProxyResource(new URL("loop.png", allowed), {
      headers: {}, isAllowedUrl: (url) => url.origin === allowed.origin, maxBytes: 1024, timeoutMs: 1000
    })).rejects.toThrow("redirect limit");
    expect(count).toBe(4);
  });

  it("cancels an oversized streaming body without Content-Length before reading the rest", async () => {
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(8));
      },
      cancel() { cancelled = true; }
    }, { highWaterMark: 0 });
    await expect(readBoundedBody(new Response(body), 10)).rejects.toBeInstanceOf(UpstreamBodyTooLargeError);
    expect(reads).toBe(2);
    expect(cancelled).toBe(true);
  });

  it("cancels a declared oversized body before reading it", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await expect(readBoundedBody(new Response(body, { headers: { "content-length": "1000" } }), 10))
      .rejects.toBeInstanceOf(UpstreamBodyTooLargeError);
    expect(cancelled).toBe(true);
  });

  it("retains the timeout after response headers when the body stalls", async () => {
    const allowed = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.flushHeaders();
      response.write("start");
    });
    const started = Date.now();
    await expect(fetchBoundedProxyResource(new URL("radar.png", allowed), {
      headers: {}, isAllowedUrl: (url) => url.origin === allowed.origin, maxBytes: 1024, timeoutMs: 150
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("rejects URL credentials without sending them to an upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchBoundedProxyResource(new URL("https://token:secret@example.test/radar.png"), {
      headers: {}, isAllowedUrl: () => true, maxBytes: 1024, timeoutMs: 1000
    })).rejects.toThrow("destination is not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

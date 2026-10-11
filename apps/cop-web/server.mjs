import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";
import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const distRoot = path.resolve(distDir);
const port = Number.parseInt(process.env.COP_WEB_PORT ?? "4311", 10);
const apiBase = process.env.COP_API_BASE_URL ?? "http://localhost:4310";
const allowedHosts = parseAllowedHosts(process.env.COP_WEB_ALLOWED_HOSTS);

const upstreamTimeoutMs = 30_000;

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error("cop-web request failed", error instanceof Error ? error.message : String(error));
    if (response.headersSent) {
      response.destroy();
    } else {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Internal Server Error");
    }
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

server.listen(port, "0.0.0.0", () => {
  console.log(`COP Web serving / on http://0.0.0.0:${port}`);
});

async function handleRequest(request, response) {
  if (!isAllowedHost(request.headers.host)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  const requestTarget = request.url ?? "/";
  // This is an origin server, not an HTTP forward proxy. Never accept a
  // client-selected authority when relaying the Matrix push endpoint.
  if (!requestTarget.startsWith("/") || requestTarget.startsWith("//")) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }
  let url;
  try {
    url = new URL(requestTarget, "http://localhost");
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }
  if (url.pathname === "/health/live") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (url.pathname === "/_matrix/push/v1/notify") {
    proxyApiRequest(request, response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  if (url.pathname === "/ardos-demo" || url.pathname === "/ardos-demo/" || url.pathname === "/ardos-demo/index.html") {
    response.writeHead(302, { "Cache-Control": "no-cache", Location: "/demo/flood-central-bohemia" });
    response.end();
    return;
  }

  if (url.pathname === "/o-aplikaci") {
    response.writeHead(308, { Location: "/o-aplikaci/", "Cache-Control": "no-cache" });
    response.end();
    return;
  }
  if (url.pathname === "/demo/flood-central-bohemia") {
    const html = (await fs.readFile(path.join(distDir, "index.html"), "utf8"))
      .replace(/<title>[^<]*<\/title>/u, "<title>Povodňová ukázka COP – syntetický scénář</title>")
      .replace('content="noindex,follow"', 'content="index,follow"')
      .replace(
        "</head>",
        '<meta name="description" content="Veřejná povodňová ukázka civilní situační mapy COP. Modelový rozliv a sdělení fiktivní obce, výhradně syntetická data."><link rel="canonical" href="https://cop.zeleznalady.cz/demo/flood-central-bohemia"><meta property="og:title" content="Povodňová ukázka COP – syntetický scénář"><meta property="og:description" content="Výhradně syntetická data, nikoli aktuální povodeň."><meta property="og:type" content="website"><meta property="og:url" content="https://cop.zeleznalady.cz/demo/flood-central-bohemia"></head>'
      );
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : html);
    return;
  }
  await serveStatic(url.pathname, request, response);
}

function proxyApiRequest(request, response) {
  const target = new URL(apiBase);
  const incoming = new URL(request.url ?? "/", "http://localhost");
  target.pathname = "/_matrix/push/v1/notify";
  target.search = incoming.search;
  target.hash = "";
  const transport = target.protocol === "https:" ? https : http;
  let upstream;
  let timedOut = false;
  const sendFailure = () => {
    if (response.destroyed || response.writableEnded) {
      return;
    }
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(timedOut ? 504 : 502, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify({ rejected: [] }));
  };
  const proxyRequest = transport.request(
    target,
    {
      headers: {
        ...sanitizeProxyHeaders(request.headers),
        host: target.host
      },
      method: request.method
    },
    (result) => {
      upstream = result;
      upstream.on("error", sendFailure);
      response.writeHead(upstream.statusCode ?? 502, sanitizeProxyHeaders(upstream.headers));
      upstream.pipe(response);
    }
  );
  const timeout = setTimeout(() => {
    timedOut = true;
    proxyRequest.destroy(new Error("COP API proxy timed out."));
    upstream?.destroy();
    sendFailure();
  }, upstreamTimeoutMs);
  timeout.unref();
  const cleanup = () => {
    clearTimeout(timeout);
    request.unpipe(proxyRequest);
    proxyRequest.destroy();
    upstream?.destroy();
  };
  response.once("close", cleanup);
  request.once("aborted", cleanup);
  proxyRequest.on("error", sendFailure);
  request.pipe(proxyRequest);
}

function sanitizeProxyHeaders(headers) {
  const nextHeaders = { ...headers };
  const connectionTokens = String(headers.connection ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  for (const name of [
    ...connectionTokens,
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
  ]) {
    delete nextHeaders[name];
  }
  return nextHeaders;
}

async function serveStatic(pathname, request, response) {
  const method = request.method ?? "GET";
  const candidate = resolveRequestPath(pathname);
  if (!candidate) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }

  const filePath = await resolveFilePath(candidate);
  if (!filePath) {
    if (shouldFallbackToIndex(pathname)) {
      const indexPath = await resolveFilePath(path.join(distDir, "index.html"));
      if (!indexPath) {
        throw new Error("COP web index is unavailable.");
      }
      await sendFile(indexPath, request, response, { fallbackIndex: true });
      return;
    }
    response.writeHead(404, { "Cache-Control": "no-cache", "Content-Type": "text/plain; charset=utf-8" });
    response.end(method === "HEAD" ? undefined : "Not Found");
    return;
  }

  await sendFile(filePath, request, response);
}

function resolveRequestPath(pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, ""));
  } catch {
    return null;
  }
  if (relativePath.includes("\0")) {
    return null;
  }
  const candidate = path.resolve(distDir, relativePath);
  return candidate === distRoot || candidate.startsWith(`${distRoot}${path.sep}`) ? candidate : null;
}

async function safeStaticPath(candidate) {
  const realPath = await fs.realpath(candidate);
  const root = path.resolve(distDir);
  return realPath === root || realPath.startsWith(`${root}${path.sep}`) ? realPath : null;
}

async function resolveFilePath(candidate) {
  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) {
      return await safeStaticPath(candidate);
    }
    if (stat.isDirectory()) {
      const indexPath = path.join(candidate, "index.html");
      const indexStat = await fs.stat(indexPath);
      return indexStat.isFile() ? await safeStaticPath(indexPath) : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function sendFile(filePath, request, response, options = {}) {
  const method = request.method ?? "GET";
  const type = contentType(filePath);
  const compression = compressionForRequest(request, type);
  const headers = {
    "Cache-Control": cacheControl(filePath, options),
    "Content-Type": type,
    Vary: "Accept-Encoding"
  };
  if (compression) {
    headers["Content-Encoding"] = compression.name;
  }

  response.writeHead(200, headers);
  if (method === "HEAD") {
    response.end();
    return;
  }

  const source = createReadStream(filePath);
  if (!compression) {
    await pipeline(source, response);
    return;
  }
  await pipeline(source, compression.stream(), response);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function shouldFallbackToIndex(pathname) {
  // Preserve actual app entry routes; unknown paths must not produce soft 404s.
  return (
    pathname === "/" ||
    pathname === "/chat" ||
    pathname.startsWith("/chat/") ||
    pathname === "/xr" ||
    pathname.startsWith("/xr/") ||
    pathname === "/globe" ||
    pathname.startsWith("/globe/") ||
    pathname.startsWith("/mobile/pair/")
  );
}

function cacheControl(filePath, options) {
  const relative = path.relative(distRoot, filePath).replace(/\\/gu, "/");
  if (
    options.fallbackIndex ||
    relative === "index.html" ||
    relative === "asset-manifest.json" ||
    relative === "cop-service-worker.js" ||
    relative === "site.webmanifest"
  ) {
    return "no-cache";
  }
  if (relative.startsWith("assets/")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}

function compressionForRequest(request, type) {
  if (!isCompressible(type)) {
    return null;
  }
  const accepted = String(request.headers["accept-encoding"] ?? "");
  const brQuality = encodingQuality(accepted, "br");
  const gzipQuality = encodingQuality(accepted, "gzip");
  if (brQuality > 0 && brQuality >= gzipQuality) {
    return {
      name: "br",
      // Static responses are compressed on demand: the default quality 11
      // spends seconds recompressing large map/chat bundles on every request.
      stream: () => createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } })
    };
  }
  if (gzipQuality > 0) {
    return { name: "gzip", stream: createGzip };
  }
  return null;
}

function encodingQuality(accepted, encoding) {
  for (const token of accepted.toLowerCase().split(",")) {
    const [name, ...parameters] = token.trim().split(";");
    if (name !== encoding) {
      continue;
    }
    const quality = parameters.map((value) => value.trim()).find((value) => value.startsWith("q="));
    const value = quality === undefined ? 1 : Number(quality.slice(2));
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
  }
  return 0;
}

function isCompressible(type) {
  return /^(text\/|application\/(javascript|json|manifest\+json|wasm))/u.test(type) || type === "image/svg+xml";
}

function parseAllowedHosts(value) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isAllowedHost(value) {
  if (allowedHosts.size === 0) {
    return true;
  }
  const host = hostnameFromAuthority(value);
  return Boolean(host && (allowedHosts.has(host) || isLocalhost(host)));
}

function hostnameFromAuthority(value) {
  try {
    return new URL(`http://${value ?? ""}`).hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  } catch {
    return "";
  }
}

function isLocalhost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".xml") return "application/xml; charset=utf-8";
  if (extension === ".txt") return "text/plain; charset=utf-8";
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".js" || extension === ".mjs") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  if (extension === ".webmanifest") {
    return "application/manifest+json; charset=utf-8";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".wasm") {
    return "application/wasm";
  }
  return "application/octet-stream";
}

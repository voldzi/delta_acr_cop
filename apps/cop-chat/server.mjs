import { createReadStream, promises as fs } from "node:fs";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const port = Number.parseInt(process.env.COP_CHAT_PORT ?? "4314", 10);
const apiBase = process.env.COP_API_BASE_URL ?? "http://localhost:4310";
const basePath = normalizeBasePath(process.env.COP_CHAT_BASE_PATH ?? "/chat/");
const tokenProxyPath = `${basePath}oidc/token`;
const allowedHosts = parseAllowedHosts(process.env.COP_CHAT_ALLOWED_HOSTS);

const upstreamTimeoutMs = 30_000;

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error("cop-chat request failed", error instanceof Error ? error.message : String(error));
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
  console.log(`COP Chat serving ${basePath} on http://0.0.0.0:${port}`);
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
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (url.pathname === tokenProxyPath) {
    await proxyOidcTokenRequest(request, response);
    return;
  }
  if (url.pathname === "/_matrix/push/v1/notify") {
    proxyApiRequest(request, response);
    return;
  }

  if (!url.pathname.startsWith(basePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  await serveStatic(url.pathname.slice(basePath.length), request, response);
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

async function proxyOidcTokenRequest(request, response) {
  const corsHeaders = corsHeadersForOrigin(request.headers.origin, request.headers.host);
  if (request.headers.origin && !corsHeaders) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "3600",
      ...corsHeaders
    });
    response.end();
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST, OPTIONS" });
    response.end();
    return;
  }

  const issuer = (process.env.COP_OIDC_ISSUER ?? "").replace(/\/+$/u, "");
  if (!issuer) {
    response.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "oidc_proxy_not_configured" }));
    return;
  }

  let body;
  try {
    body = await readRequestBody(request, 64 * 1024);
  } catch (error) {
    if (error?.code !== "BODY_TOO_LARGE") {
      throw error;
    }
    response.writeHead(413, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    });
    response.end(JSON.stringify({ error: "oidc_request_too_large" }));
    return;
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, upstreamTimeoutMs);
  timeout.unref();
  const abort = () => controller.abort();
  response.once("close", abort);
  try {
    const upstream = await fetch(`${issuer}/protocol/openid-connect/token`, {
      body,
      headers: {
        Accept: "application/json",
        "Content-Type": request.headers["content-type"] ?? "application/x-www-form-urlencoded"
      },
      method: "POST",
      // Token POST bodies contain authorization codes or refresh tokens.
      // Keep them on the configured issuer instead of following a redirect.
      redirect: "error",
      signal: controller.signal
    });
    const payload = await readUpstreamBody(upstream.body, 256 * 1024);
    response.writeHead(upstream.status, {
      "Cache-Control": "no-store",
      "Content-Length": String(payload.length),
      "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      Pragma: "no-cache",
      ...corsHeaders
    });
    response.end(payload);
  } catch {
    if (!response.destroyed && !response.writableEnded) {
      response.writeHead(timedOut ? 504 : 502, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders
      });
      response.end(JSON.stringify({ error: timedOut ? "oidc_upstream_timeout" : "oidc_upstream_unavailable" }));
    }
  } finally {
    clearTimeout(timeout);
    response.off("close", abort);
  }
}

async function serveStatic(requestPath, request, response) {
  const method = request.method ?? "GET";
  let relativePath;
  try {
    relativePath = decodeURIComponent(requestPath || "index.html");
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }
  if (relativePath.includes("\0")) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }
  const candidate = path.resolve(distDir, relativePath);
  const distRoot = `${path.resolve(distDir)}${path.sep}`;
  if (!candidate.startsWith(distRoot) && candidate !== path.resolve(distDir)) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }

  const filePath = await resolveFilePath(candidate);
  if (!filePath) {
    if (isStaticAssetRequest(relativePath)) {
      response.writeHead(404, { "Cache-Control": "no-cache", "Content-Type": "text/plain; charset=utf-8" });
      response.end(method === "HEAD" ? undefined : "Not Found");
      return;
    }
    await sendIndex(method, request, response);
    return;
  }

  await sendFile(filePath, method, request, response);
}

async function sendFile(filePath, method, request, response) {
  const type = contentType(filePath);
  const compression = compressionForRequest(request, type);
  const headers = {
    "Cache-Control":
      filePath.endsWith("index.html") || filePath.endsWith("asset-manifest.json")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
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
  if (!compression) {
    await pipeline(createReadStream(filePath), response);
    return;
  }
  await pipeline(createReadStream(filePath), compression.stream(), response);
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

async function sendIndex(method, request, response) {
  const filePath = await resolveFilePath(path.join(distDir, "index.html"));
  if (!filePath) {
    throw new Error("COP chat index is unavailable.");
  }
  await sendFile(filePath, method, request, response);
}

function isStaticAssetRequest(relativePath) {
  const normalized = relativePath.replace(/^\/+/u, "");
  return normalized.startsWith("assets/") || path.extname(normalized) !== "";
}

function normalizeBasePath(value) {
  const trimmed = value.trim() || "/chat/";
  return `/${trimmed.replace(/^\/+|\/+$/gu, "")}/`;
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

function corsHeadersForOrigin(value, requestHost) {
  if (!value) {
    return {};
  }
  if (!isAllowedOrigin(value, requestHost)) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": value,
    Vary: "Origin"
  };
}

function isAllowedOrigin(value, requestHost) {
  let origin;
  try {
    origin = new URL(value);
  } catch {
    return false;
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    return false;
  }
  const originHost = origin.hostname.toLowerCase();
  const host = hostnameFromAuthority(requestHost);
  return Boolean(originHost && (originHost === host || allowedHosts.has(originHost) || isLocalhost(originHost)));
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

async function readRequestBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBytes) {
      request.resume();
      const error = new Error("OIDC token request body is too large.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readUpstreamBody(body, maxBytes) {
  if (!body) {
    return Buffer.alloc(0);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("OIDC token response body is too large.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".js" || extension === ".mjs") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".json" || extension === ".webmanifest") {
    return "application/json; charset=utf-8";
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

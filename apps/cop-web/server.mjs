import { createBrotliCompress, createGzip } from "node:zlib";
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

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error("cop-web request failed", error instanceof Error ? error.message : String(error));
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    response.end("Internal Server Error");
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`COP Web serving / on http://0.0.0.0:${port}`);
});

async function handleRequest(request, response) {
  if (!isAllowedHost(request.headers.host)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
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

  await serveStatic(url.pathname, request, response);
}

function proxyApiRequest(request, response) {
  const target = new URL(request.url ?? "/", apiBase);
  const transport = target.protocol === "https:" ? https : http;
  const proxyRequest = transport.request(
    target,
    {
      headers: {
        ...request.headers,
        host: target.host
      },
      method: request.method
    },
    (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, sanitizeProxyResponseHeaders(upstream.headers));
      upstream.pipe(response);
    }
  );
  proxyRequest.on("error", () => {
    response.writeHead(502, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify({ rejected: [] }));
  });
  request.pipe(proxyRequest);
}

function sanitizeProxyResponseHeaders(headers) {
  const nextHeaders = { ...headers };
  delete nextHeaders.connection;
  delete nextHeaders["keep-alive"];
  delete nextHeaders["proxy-authenticate"];
  delete nextHeaders["proxy-authorization"];
  delete nextHeaders.te;
  delete nextHeaders.trailer;
  delete nextHeaders["transfer-encoding"];
  delete nextHeaders.upgrade;
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
      await sendFile(path.join(distDir, "index.html"), request, response, { fallbackIndex: true });
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
  const candidate = path.resolve(distDir, relativePath);
  return candidate === distRoot || candidate.startsWith(`${distRoot}${path.sep}`) ? candidate : null;
}

async function resolveFilePath(candidate) {
  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) {
      return candidate;
    }
    if (stat.isDirectory()) {
      const indexPath = path.join(candidate, "index.html");
      const indexStat = await fs.stat(indexPath);
      return indexStat.isFile() ? indexPath : null;
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
  if (pathname.startsWith("/assets/") || pathname.startsWith("/icons/") || pathname.startsWith("/symbols/")) {
    return false;
  }
  if (pathname === "/cop-service-worker.js" || pathname === "/site.webmanifest") {
    return false;
  }
  return path.extname(pathname) === "";
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
  if (/\bbr\b/u.test(accepted)) {
    return { name: "br", stream: createBrotliCompress };
  }
  if (/\bgzip\b/u.test(accepted)) {
    return { name: "gzip", stream: createGzip };
  }
  return null;
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
  return (value ?? "").replace(/^\[/u, "").split("]")[0].split(":")[0]?.toLowerCase() ?? "";
}

function isLocalhost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
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

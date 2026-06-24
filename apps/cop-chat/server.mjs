import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const port = Number.parseInt(process.env.COP_CHAT_PORT ?? "4314", 10);
const basePath = normalizeBasePath(process.env.COP_CHAT_BASE_PATH ?? "/chat/");
const tokenProxyPath = `${basePath}oidc/token`;
const allowedHosts = parseAllowedHosts(process.env.COP_CHAT_ALLOWED_HOSTS);

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error("cop-chat request failed", error instanceof Error ? error.message : String(error));
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    response.end("Internal Server Error");
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`COP Chat serving ${basePath} on http://0.0.0.0:${port}`);
});

async function handleRequest(request, response) {
  if (!isAllowedHost(request.headers.host)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/health/live") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (url.pathname === tokenProxyPath) {
    await proxyOidcTokenRequest(request, response);
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

  await serveStatic(url.pathname.slice(basePath.length), request.method ?? "GET", response);
}

async function proxyOidcTokenRequest(request, response) {
  if (request.method === "OPTIONS") {
    const origin = request.headers.origin ?? "";
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Max-Age": "3600"
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

  const body = await readRequestBody(request, 64 * 1024);
  const upstream = await fetch(`${issuer}/protocol/openid-connect/token`, {
    body,
    headers: {
      "Accept": "application/json",
      "Content-Type": request.headers["content-type"] ?? "application/x-www-form-urlencoded"
    },
    method: "POST"
  });
  const payload = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(upstream.status, {
    "Cache-Control": "no-store",
    "Content-Length": String(payload.length),
    "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "Pragma": "no-cache"
  });
  response.end(payload);
}

async function serveStatic(requestPath, method, response) {
  const relativePath = decodeURIComponent(requestPath || "index.html");
  const candidate = path.resolve(distDir, relativePath);
  const distRoot = `${path.resolve(distDir)}${path.sep}`;
  if (!candidate.startsWith(distRoot) && candidate !== path.resolve(distDir)) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }

  const filePath = await resolveFilePath(candidate);
  if (!filePath) {
    await sendIndex(method, response);
    return;
  }

  response.writeHead(200, {
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Type": contentType(filePath)
  });
  if (method === "HEAD") {
    response.end();
    return;
  }
  await pipeline(createReadStream(filePath), response);
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

async function sendIndex(method, response) {
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Type": "text/html; charset=utf-8"
  });
  if (method === "HEAD") {
    response.end();
    return;
  }
  await pipeline(createReadStream(path.join(distDir, "index.html")), response);
}

function normalizeBasePath(value) {
  const trimmed = value.trim() || "/chat/";
  return `/${trimmed.replace(/^\/+|\/+$/gu, "")}/`;
}

function parseAllowedHosts(value) {
  return new Set((value ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
}

function isAllowedHost(value) {
  if (allowedHosts.size === 0) {
    return true;
  }
  const host = (value ?? "").split(":")[0]?.toLowerCase();
  return Boolean(host && (allowedHosts.has(host) || host === "localhost" || host === "127.0.0.1"));
}

async function readRequestBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("OIDC token request body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

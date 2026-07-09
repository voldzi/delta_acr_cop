#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const checks = [
  {
    app: "cop-web",
    distDir: "apps/cop-web/dist",
    indexPath: "apps/cop-web/dist/index.html",
    requiredFiles: ["asset-manifest.json", "cop-service-worker.js", "site.webmanifest"]
  },
  {
    app: "cop-chat",
    distDir: "apps/cop-chat/dist",
    indexPath: "apps/cop-chat/dist/index.html",
    requiredFiles: ["asset-manifest.json"]
  }
];

let failed = false;

for (const check of checks) {
  verifyStaticApp(check);
}

if (!failed) {
  await verifyStaticServers();
}

if (failed) {
  process.exitCode = 1;
}

function verifyStaticApp(check) {
  const indexAbsolute = join(repoRoot, check.indexPath);
  let html;
  try {
    html = readFileSync(indexAbsolute, "utf8");
  } catch {
    fail(`${check.app}: missing ${check.indexPath}. Run pnpm build first.`);
    return;
  }

  const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter(
      (ref) =>
        ref.startsWith("/assets/") ||
        ref.startsWith("/chat/assets/") ||
        ref.startsWith("./assets/") ||
        ref.startsWith("assets/")
    )
    .map((ref) => ref.replace(/^\/chat\//u, "").replace(/^\.?\//u, ""));

  for (const assetRef of assetRefs) {
    requireFile(check.app, join(check.distDir, assetRef));
  }
  for (const required of check.requiredFiles) {
    requireFile(check.app, join(check.distDir, required));
  }
  ok(`${check.app}: ${assetRefs.length} HTML asset refs and ${check.requiredFiles.length} required PWA files verified`);
}

async function verifyStaticServers() {
  const webAsset = firstHtmlAsset("apps/cop-web/dist/index.html");
  const chatAsset = firstHtmlAsset("apps/cop-chat/dist/index.html");
  const web = startServer("cop-web", "apps/cop-web", "COP_WEB_PORT", "49311");
  const chat = startServer("cop-chat", "apps/cop-chat", "COP_CHAT_PORT", "49314", {
    COP_CHAT_BASE_PATH: "/chat/"
  });

  try {
    await waitForOk("http://127.0.0.1:49311/health/live");
    await waitForOk("http://127.0.0.1:49314/health/live");
    await expectHeader("cop-web", `http://127.0.0.1:49311/${webAsset}`, {
      cacheIncludes: "immutable",
      contentEncoding: "br",
      status: 200
    });
    await expectHeader("cop-web", "http://127.0.0.1:49311/assets/__missing__.js", { status: 404 });
    await expectHeader("cop-web", "http://127.0.0.1:49311/mobile/pair/demo", { status: 200 });
    await expectHeader("cop-web", "http://127.0.0.1:49311/site.webmanifest", {
      contentTypeIncludes: "application/manifest+json",
      status: 200
    });
    await expectHeader("cop-web", "http://127.0.0.1:49311/asset-manifest.json", {
      cacheIncludes: "no-cache",
      status: 200
    });

    await expectHeader("cop-chat", `http://127.0.0.1:49314/chat/${chatAsset}`, {
      cacheIncludes: "immutable",
      contentEncoding: "br",
      status: 200
    });
    await expectHeader("cop-chat", "http://127.0.0.1:49314/chat/assets/__missing__.js", { status: 404 });
    await expectHeader("cop-chat", "http://127.0.0.1:49314/chat/conv_demo", { status: 200 });
    await expectHeader("cop-chat", "http://127.0.0.1:49314/chat/asset-manifest.json", {
      cacheIncludes: "no-cache",
      status: 200
    });
    ok("static runtime smoke verified");
  } finally {
    stopServer(web);
    stopServer(chat);
  }
}

function firstHtmlAsset(indexPath) {
  const html = readFileSync(join(repoRoot, indexPath), "utf8");
  const asset = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/gu)]
    .map((match) => match[1])
    .find((ref) => ref.endsWith(".js") || ref.endsWith(".css"));
  if (!asset) {
    throw new Error(`No asset reference found in ${indexPath}`);
  }
  return asset.replace(/^\/chat\//u, "").replace(/^\/+/u, "");
}

function startServer(label, cwd, portEnv, port, extraEnv = {}) {
  const child = spawn("node", ["server.mjs"], {
    cwd: join(repoRoot, cwd),
    env: {
      ...process.env,
      ...extraEnv,
      [portEnv]: port
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

async function waitForOk(url) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`${url} did not become ready`);
}

async function expectHeader(app, url, expected) {
  const response = await fetch(url, {
    headers: {
      "Accept-Encoding": "br, gzip"
    },
    method: "HEAD"
  });
  if (response.status !== expected.status) {
    fail(`${app}: ${url} returned ${response.status}, expected ${expected.status}`);
    return;
  }
  if (expected.cacheIncludes) {
    const cacheControl = response.headers.get("cache-control") ?? "";
    if (!cacheControl.includes(expected.cacheIncludes)) {
      fail(`${app}: ${url} cache-control ${cacheControl || "(missing)"} does not include ${expected.cacheIncludes}`);
    }
  }
  if (expected.contentEncoding) {
    const encoding = response.headers.get("content-encoding") ?? "";
    if (encoding !== expected.contentEncoding) {
      fail(`${app}: ${url} content-encoding ${encoding || "(missing)"}, expected ${expected.contentEncoding}`);
    }
  }
  if (expected.contentTypeIncludes) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes(expected.contentTypeIncludes)) {
      fail(
        `${app}: ${url} content-type ${contentType || "(missing)"} does not include ${expected.contentTypeIncludes}`
      );
    }
  }
}

function stopServer(child) {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
}

function requireFile(app, relativePath) {
  try {
    const stat = statSync(join(repoRoot, relativePath));
    if (!stat.isFile()) {
      fail(`${app}: ${relativePath} is not a file`);
    }
  } catch {
    fail(`${app}: missing ${relativePath}`);
  }
}

function ok(message) {
  console.log(`✓ ${message}`);
}

function fail(message) {
  failed = true;
  console.error(`✗ ${message}`);
}

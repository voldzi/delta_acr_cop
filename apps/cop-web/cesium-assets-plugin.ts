import { createReadStream } from "node:fs";
import { cp, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ResolvedConfig } from "vite";

const cesiumDirectories = ["Assets", "ThirdParty", "Widgets", "Workers"] as const;
const cesiumRoot = fileURLToPath(new URL("./node_modules/cesium/Build/Cesium/", import.meta.url));

// Cesium loads a fixed set of runtime directories. Native copying avoids an
// unnecessary glob/watch dependency for paths that never use glob patterns.
export function cesiumAssetsPlugin(sourceRoot = cesiumRoot): Plugin {
  let config: ResolvedConfig;
  return {
    name: "cop-cesium-runtime-assets",
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      if (config.command !== "build") return;
      const outputRoot = path.resolve(config.root, config.build.outDir, "cesium");
      await Promise.all(
        cesiumDirectories.map((directory) =>
          cp(path.join(sourceRoot, directory), path.join(outputRoot, directory), { recursive: true, force: true })
        )
      );
    },
    configureServer(server) {
      const prefix = `${config.base.replace(/\/$/u, "")}/cesium/`;
      server.middlewares.use((request, response, next) => {
        void serveCesiumAsset(sourceRoot, prefix, request, response, next).catch(() => {
          if (response.headersSent) {
            response.destroy();
          } else {
            response.statusCode = 500;
            response.end("Cesium runtime asset is unavailable.");
          }
        });
      });
    }
  };
}

async function serveCesiumAsset(
  sourceRoot: string,
  prefix: string,
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void
): Promise<void> {
  const rawPath = (request.url ?? "").split("?")[0] ?? "";
  if (!rawPath.startsWith(prefix)) {
    next();
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(rawPath.slice(prefix.length));
  } catch {
    response.statusCode = 400;
    response.end("Bad Request");
    return;
  }
  const segments = relativePath.split("/");
  if (
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    segments.some((segment) => segment === "." || segment === "..") ||
    !cesiumDirectories.some((directory) => directory === segments[0])
  ) {
    response.statusCode = 400;
    response.end("Bad Request");
    return;
  }
  let filePath: string;
  let fileSize: number;
  try {
    const root = await realpath(sourceRoot);
    filePath = await realpath(path.join(root, relativePath));
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      response.statusCode = 404;
      response.end("Not Found");
      return;
    }
    const file = await stat(filePath);
    if (!file.isFile()) {
      response.statusCode = 404;
      response.end("Not Found");
      return;
    }
    fileSize = file.size;
  } catch {
    response.statusCode = 404;
    response.end("Not Found");
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": fileSize,
    "Content-Type": contentType(filePath)
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await pipeline(createReadStream(filePath), response);
}

function contentType(filePath: string): string {
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp"
  };
  return types[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

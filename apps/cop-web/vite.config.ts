import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";
import { fileURLToPath, URL } from "node:url";

const apiBase = process.env.COP_API_BASE_URL ?? "http://localhost:4310";
const chatBase = process.env.COP_CHAT_PROXY_TARGET ?? `http://localhost:${process.env.COP_CHAT_PORT ?? "4314"}`;
const deployDomain = process.env.COP_DEPLOY_DOMAIN ?? "docker.home.cz";
const allowedHosts = [
  deployDomain,
  ...(process.env.COP_WEB_ALLOWED_HOSTS ?? "").split(","),
  "docker.home.cz",
  "localhost",
  "127.0.0.1"
]
  .map((host) => host.trim())
  .filter((host, index, hosts) => host.length > 0 && hosts.indexOf(host) === index);

const iosAppId = process.env.COP_IOS_APP_ID ?? "LM6W548X36.cz.zeleznalady.csm.messenger";
const appleAppSiteAssociation = JSON.stringify(
  {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [iosAppId],
          components: [
            {
              "/": "/mobile/pair/*",
              comment: "CSM Messenger pairing links"
            }
          ],
          paths: ["/mobile/pair/*"]
        }
      ]
    },
    webcredentials: {
      apps: [iosAppId]
    }
  },
  null,
  2
);

function appleAppSiteAssociationPreviewPlugin(): PluginOption {
  return {
    name: "cop-apple-app-site-association-preview",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?")[0] ?? "";
        if (path !== "/.well-known/apple-app-site-association") {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        response.end(appleAppSiteAssociation);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), appleAppSiteAssociationPreviewPlugin()],
  resolve: {
    alias: {
      "@cop/messaging/webPush": fileURLToPath(new URL("../../packages/messaging/src/webPush.ts", import.meta.url))
    }
  },
  build: {
    chunkSizeWarningLimit: 1200,
    manifest: "asset-manifest.json",
    target: ["es2020", "safari16"],
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/maplibre-gl/")) {
            return "maplibre";
          }
          if (id.includes("/packages/geo-client/")) {
            return "geo-client";
          }
          if (id.includes("/node_modules/qrcode/")) {
            return "qrcode";
          }
          return undefined;
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: Number.parseInt(process.env.COP_WEB_PORT ?? "4311", 10),
    proxy: {
      "/api": apiBase,
      "/_matrix": apiBase,
      "/chat": {
        changeOrigin: true,
        target: chatBase,
        ws: true
      },
      "/health": apiBase,
      "/metrics": apiBase
    }
  },
  preview: {
    host: "0.0.0.0",
    port: Number.parseInt(process.env.COP_WEB_PORT ?? "4311", 10),
    allowedHosts,
    proxy: {
      "/_matrix": apiBase,
      "/api": apiBase,
      "/health": apiBase,
      "/metrics": apiBase
    }
  }
});

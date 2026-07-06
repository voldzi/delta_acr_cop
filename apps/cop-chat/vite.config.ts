import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const apiBase = process.env.COP_API_BASE_URL ?? "http://localhost:4310";
const deployDomain = process.env.COP_DEPLOY_DOMAIN ?? "docker.home.cz";
const chatBase = process.env.COP_CHAT_BASE_PATH ?? "/chat/";
const allowedHosts = [
  deployDomain,
  ...(process.env.COP_CHAT_ALLOWED_HOSTS || process.env.COP_WEB_ALLOWED_HOSTS || "").split(","),
  "docker.home.cz",
  "localhost",
  "127.0.0.1"
]
  .map((host) => host.trim())
  .filter((host, index, hosts) => host.length > 0 && hosts.indexOf(host) === index);

export default defineConfig({
  base: chatBase.endsWith("/") ? chatBase : `${chatBase}/`,
  plugins: [react()],
  resolve: {
    alias: {
      "@cop/messaging/webPush": fileURLToPath(new URL("../../packages/messaging/src/webPush.ts", import.meta.url))
    }
  },
  build: {
    chunkSizeWarningLimit: 2300,
    modulePreload: {
      resolveDependencies(_url, deps) {
        return deps.filter((dep) => !/(^|\/)matrix-[^/]+\.js$/u.test(dep));
      }
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes("/node_modules/matrix-js-sdk/") ? "matrix" : undefined;
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: Number.parseInt(process.env.COP_CHAT_PORT ?? "4314", 10),
    proxy: {
      "/api": apiBase,
      "/health": apiBase
    }
  },
  preview: {
    allowedHosts,
    host: "0.0.0.0",
    port: Number.parseInt(process.env.COP_CHAT_PORT ?? "4314", 10)
  }
});

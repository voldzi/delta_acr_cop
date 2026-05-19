import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiBase = process.env.COP_API_BASE_URL ?? "http://localhost:4310";
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

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ["maplibre-gl"]
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: Number.parseInt(process.env.COP_WEB_PORT ?? "4311", 10),
    proxy: {
      "/api": apiBase,
      "/health": apiBase,
      "/metrics": apiBase
    }
  },
  preview: {
    host: "0.0.0.0",
    port: Number.parseInt(process.env.COP_WEB_PORT ?? "4311", 10),
    allowedHosts
  }
});

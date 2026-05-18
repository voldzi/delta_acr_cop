import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiBase = process.env.COP_API_BASE_URL ?? "http://localhost:4310";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: Number.parseInt(process.env.COP_WEB_PORT ?? "4311", 10),
    proxy: {
      "/api": apiBase,
      "/health": apiBase,
      "/metrics": apiBase
    }
  }
});

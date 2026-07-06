import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@cop/messaging/webPush": fileURLToPath(new URL("./packages/messaging/src/webPush.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    globals: true,
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx"
    ],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});

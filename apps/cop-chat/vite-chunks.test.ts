import { describe, expect, it } from "vitest";

import { chatChunkFileName, chatManualChunk } from "./vite-chunks";

describe("COP Chat chunk boundaries", () => {
  it("keeps Matrix in named async chunks without forcing it into the shell graph", () => {
    const matrixModule = "/repo/node_modules/matrix-js-sdk/lib/browser-index.js";

    expect(chatManualChunk(matrixModule)).toBeUndefined();
    expect(chatChunkFileName({ moduleIds: [matrixModule] })).toBe("assets/matrix-[hash].js");
  });

  it("keeps the shared React runtime stable", () => {
    expect(chatManualChunk("/repo/node_modules/react-dom/client.js")).toBe("react-runtime");
    expect(chatChunkFileName({ moduleIds: ["/repo/src/dialog.tsx"] })).toBe("assets/[name]-[hash].js");
  });
});

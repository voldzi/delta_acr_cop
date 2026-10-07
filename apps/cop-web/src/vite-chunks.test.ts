import { describe, expect, it } from "vitest";
import { webChunkName } from "../vite-chunks";

const engine = "/node_modules/@cesium/engine/Source/index.js";
const dependency = "/node_modules/mersenne-twister/index.js";
const shared = "/node_modules/kdbush/index.js";
const map = "/node_modules/maplibre-gl/dist/maplibre-gl.js";

function graph(importers: Record<string, string[]>, dynamicImporters: Record<string, string[]> = {}) {
  return {
    getModuleInfo(id: string) {
      return id in importers ? { importers: importers[id] ?? [], dynamicImporters: dynamicImporters[id] ?? [] } : null;
    }
  };
}

describe("optional Cesium chunk boundary", () => {
  it("keeps engine-only dependencies, including cyclic libraries, with the engine", () => {
    const indirect = "/node_modules/indirect/index.js";
    const modules = graph({ [dependency]: [indirect], [indirect]: [dependency, engine] });
    expect(webChunkName(engine, modules)).toBe("cesium");
    expect(webChunkName(dependency, modules)).toBe("cesium");
    expect(webChunkName(indirect, modules)).toBe("cesium");
  });

  it("does not absorb libraries also needed by 2D maps or application code", () => {
    expect(webChunkName(shared, graph({ [shared]: [engine, map], [map]: ["/src/CopMap.tsx"] }))).toBeUndefined();
    expect(webChunkName(dependency, graph({ [dependency]: [engine, "/src/App.tsx"] }))).toBeUndefined();
    expect(webChunkName("\0vite/preload-helper.js", graph({}))).toBeUndefined();
  });

  it("also checks dynamic importers and leaves unverified dependencies separate", () => {
    expect(webChunkName(dependency, graph({ [dependency]: [] }, { [dependency]: [engine] }))).toBe("cesium");
    expect(webChunkName(dependency, graph({ [dependency]: [engine] }, { [dependency]: ["/src/App.tsx"] })))
      .toBeUndefined();
    expect(webChunkName(dependency, graph({}))).toBeUndefined();
  });
});

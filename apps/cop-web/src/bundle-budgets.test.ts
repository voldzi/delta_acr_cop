import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type Chunk = { file: string; isEntry?: boolean; imports?: string[]; css?: string[] };
const checker = fileURLToPath(new URL("../../../scripts/check-bundle-budgets.mjs", import.meta.url));
const fixtures: string[] = [];
const required = {
  "cop-web": [
    "react-runtime-test.js", "icons-test.js", "radix-ui-test.js", "CopMap-test.js", "geo-client-test.js",
    "XrWorkspace-test.js", "GlobeWorkspace-test.js", "cesium-test.js", "TrackTable-test.js", "maplibre-test.js",
    "maplibre-gl-worker-test.js", "milsymbol-test.js", "qrcode-test.js", "maplibre-test.css"
  ],
  "cop-chat": [
    "react-runtime-test.js", "matrix-test.js", "matrix_sdk_crypto_wasm_bg-test.wasm", "pdf-test.js",
    "pdf.worker-test.mjs", "jszip.min-test.js"
  ]
};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "cop-bundle-budget-"));
  fixtures.push(root);
  const manifests: Record<string, Record<string, Chunk>> = {};
  for (const app of ["cop-web", "cop-chat"] as const) {
    const dir = path.join(root, "apps", app, "dist");
    await mkdir(path.join(dir, "assets"), { recursive: true });
    const files = [...required[app], "index-test.js", `${app}-test.js`, `${app}-test.css`];
    for (const file of files) await writeFile(path.join(dir, "assets", file), "/* synthetic build artifact */");
    const manifest: Record<string, Chunk> = {
      "index.html": { file: "assets/index-test.js", isEntry: true, imports: [`_${app}`] },
      [`_${app}`]: {
        file: `assets/${app}-test.js`, imports: ["_react", "index.html"], css: [`assets/${app}-test.css`]
      },
      _react: { file: "assets/react-runtime-test.js" }
    };
    if (app === "cop-web") {
      await writeFile(path.join(dir, "assets/PublicFloodDemo-test.js"), "/* synthetic public demo */");
      manifest._map = { file: "assets/CopMap-test.js", imports: ["_cop-web"] };
      manifest["src/PublicFloodDemo.tsx"] = { file: "assets/PublicFloodDemo-test.js", imports: ["_map"] };
      manifest._cesium = { file: "assets/cesium-test.js" };
    } else {
      manifest._matrix = { file: "assets/matrix-test.js" };
    }
    manifests[app] = manifest;
  }
  return {
    root,
    manifests,
    async check() {
      for (const [app, manifest] of Object.entries(manifests)) {
        await writeFile(path.join(root, "apps", app, "dist/asset-manifest.json"), JSON.stringify(manifest));
      }
      const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: "utf8", timeout: 10_000 });
      return { status: result.status, output: result.stdout + result.stderr };
    },
    write(app: string, file: string, bytes: Uint8Array) {
      return writeFile(path.join(root, "apps", app, "dist/assets", file), bytes);
    }
  };
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("manifest-based bundle budgets", () => {
  it("counts real shells and renamed CSS through entry stubs, without duplicating cyclic imports", async () => {
    const built = await fixture();
    const result = await built.check();
    expect(result.status).toBe(0);
    expect(result.output).toContain("cop-web: app shell static graph (2 artefaktů)");
    expect(result.output).toContain("cop-chat: initial styles (1 artefaktů)");
  });

  it("fails for a large imported application hidden behind a small entry stub", async () => {
    const built = await fixture();
    await built.write("cop-web", "cop-web-test.js", randomBytes(300 * 1024));
    const result = await built.check();
    expect(result.status).toBe(1);
    expect(result.output).toContain("✗ cop-web: app shell static graph");
  });

  it("fails for oversized initial CSS even when it is not named index", async () => {
    const built = await fixture();
    await built.write("cop-chat", "cop-chat-test.css", randomBytes(32 * 1024));
    const result = await built.check();
    expect(result.status).toBe(1);
    expect(result.output).toContain("✗ cop-chat: initial styles");
  });

  it("rejects Cesium pulled in through the lazy 2D map and Matrix made eager in chat", async () => {
    const built = await fixture();
    built.manifests["cop-web"]!._map!.imports!.push("_cesium");
    built.manifests["cop-chat"]!["_cop-chat"]!.imports!.push("_matrix");
    const result = await built.check();
    expect(result.status).toBe(1);
    expect(result.output).toContain("2D statický graf obsahuje volitelný engine assets/cesium-test.js");
    expect(result.output).toContain("počáteční statický graf obsahuje volitelný engine assets/matrix-test.js");
  });

  it("fails closed for missing manifest imports and missing emitted application files", async () => {
    const built = await fixture();
    built.manifests["cop-web"]!["_cop-web"]!.imports!.push("_missing");
    built.manifests["cop-chat"]!["_cop-chat"]!.file = "assets/not-emitted.js";
    const result = await built.check();
    expect(result.status).toBe(1);
    expect(result.output).toContain("chybějící nebo neplatný chunk _missing");
    expect(result.output).toContain("chybějící artefakt assets/not-emitted.js");
  });
});

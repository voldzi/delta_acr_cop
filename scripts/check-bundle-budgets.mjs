#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const KiB = 1024;
const repoRoot = process.cwd();

const budgets = [
  {
    app: "cop-web",
    dir: "apps/cop-web/dist/assets",
    required: true,
    appShellMaxBytes: 250 * KiB,
    stylesMaxBytes: 35 * KiB,
    entries: [
      // React 19.3 baseline is 66.0 KiB with execution-order wrappers. Keep a
      // 67 KiB cap in both clients; the application/engine budgets stay unchanged.
      { label: "React runtime", pattern: /^react-runtime-[\w-]+\.js$/, maxBytes: 67 * KiB, maxMatches: 1 },
      { label: "icon set", pattern: /^icons-[\w-]+\.js$/, maxBytes: 20 * KiB, maxMatches: 1 },
      { label: "accessible UI primitives", pattern: /^radix-ui-[\w-]+\.js$/, maxBytes: 40 * KiB, maxMatches: 1 },
      { label: "map workspace", pattern: /^CopMap-[\w-]+\.js$/, maxBytes: 65 * KiB },
      { label: "shared geo primitives", pattern: /^geo-client-[\w-]+\.js$/, maxBytes: 8 * KiB, maxMatches: 1 },
      { label: "XR workspace", pattern: /^XrWorkspace-[\w-]+\.js$/, maxBytes: 160 * KiB },
      { label: "3D workspace", pattern: /^GlobeWorkspace-[\w-]+\.js$/, maxBytes: 10 * KiB },
      { label: "Cesium 3D engine", pattern: /^cesium-[\w-]+\.js$/, maxBytes: 1_150 * KiB, maxMatches: 1 },
      { label: "track table", pattern: /^TrackTable-[\w-]+\.js$/, maxBytes: 16 * KiB },
      {
        label: "maplibre",
        pattern: /^maplibre-(?!gl-worker-)[\w-]+\.js$/,
        maxBytes: 300 * KiB,
        maxMatches: 1
      },
      {
        label: "maplibre worker",
        pattern: /^maplibre-gl-worker-[\w-]+\.js$/,
        maxBytes: 150 * KiB,
        maxMatches: 1
      },
      { label: "milsymbol", pattern: /^milsymbol-[\w-]+\.js$/, maxBytes: 210 * KiB },
      { label: "pairing QR generator", pattern: /^qrcode-[\w-]+\.js$/, maxBytes: 12 * KiB },
      { label: "maplibre styles", pattern: /^maplibre-[\w-]+\.css$/, maxBytes: 15 * KiB }
    ]
  },
  {
    app: "cop-chat",
    dir: "apps/cop-chat/dist/assets",
    required: true,
    appShellMaxBytes: 135 * KiB,
    stylesMaxBytes: 16 * KiB,
    entries: [
      { label: "React runtime", pattern: /^react-runtime-[\w-]+\.js$/, maxBytes: 67 * KiB, maxMatches: 1 },
      { label: "matrix sdk", pattern: /^matrix-[\w-]+\.js$/, maxBytes: 360 * KiB },
      { label: "matrix crypto wasm", pattern: /^matrix_sdk_crypto_wasm_bg-[\w-]+\.wasm$/, maxBytes: 2_150 * KiB },
      { label: "pdf viewer", pattern: /^pdf-[\w-]+\.js$/, maxBytes: 130 * KiB },
      { label: "pdf worker", pattern: /^pdf\.worker-[\w-]+\.mjs$/, maxBytes: 500 * KiB },
      { label: "office/archive parser", pattern: /^jszip\.min-[\w-]+\.js$/, maxBytes: 30 * KiB }
    ]
  }
];

let hasFailure = false;

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function readAssets(dir) {
  const absoluteDir = join(repoRoot, dir);
  try {
    return readdirSync(absoluteDir, { withFileTypes: true })
      .filter((item) => item.isFile())
      .map(({ name }) => ({
        name,
        size: gzipSync(readFileSync(join(absoluteDir, name))).length
      }));
  } catch {
    hasFailure = true;
    console.error(`Bundle budget: ${dir} není dostupný. Spusťte nejdřív pnpm build.`);
    return [];
  }
}

function checkEntry(app, assets, entry) {
  const matches = assets.filter((asset) => entry.pattern.test(asset.name));
  if (matches.length === 0) {
    hasFailure = true;
    console.error(`✗ ${app}: chybí artefakt ${entry.label} (${entry.pattern})`);
    return;
  }
  if (entry.maxMatches !== undefined && matches.length > entry.maxMatches) {
    hasFailure = true;
    console.error(
      `✗ ${app}: ${entry.label} je rozdělen do ${matches.length} artefaktů, povoleno je nejvýše ${entry.maxMatches}`
    );
  }
  matches.forEach((asset) => {
    const ok = asset.size <= entry.maxBytes;
    const marker = ok ? "✓" : "✗";
    const line = `${marker} ${app}: ${entry.label} ${asset.name} ${formatBytes(asset.size)} gzip / ${formatBytes(entry.maxBytes)} gzip`;
    if (ok) {
      console.log(line);
    } else {
      hasFailure = true;
      console.error(line);
    }
  });
}

budgets.forEach((budget) => {
  const assets = readAssets(budget.dir);
  budget.entries.forEach((entry) => checkEntry(budget.app, assets, entry));
  checkManifestBudgets(budget, assets);
});

function checkManifestBudgets(budget, assets) {
  const manifestPath = join(repoRoot, budget.dir, "../asset-manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Invalid manifest.");
  } catch {
    hasFailure = true;
    console.error(`Bundle budget: ${budget.app} asset manifest není dostupný nebo platný.`);
    return;
  }
  const entryKeys = Object.keys(manifest).filter((key) => manifest[key]?.isEntry);
  if (entryKeys.length === 0) {
    hasFailure = true;
    console.error(`Bundle budget: ${budget.app} asset manifest nemá vstupní modul.`);
    return;
  }

  const initial = staticGraph(manifest, entryKeys, budget.app);
  // An HTML entry may be just a re-export stub. Count the entire static
  // application graph, excluding only vendors with their own explicit caps.
  const applicationFiles = new Set(
    [...initial]
      .map((key) => manifest[key].file)
      .filter(
        (file) => /\.[cm]?js$/u.test(file) && !budget.entries.some((entry) => entry.pattern.test(file.split("/").pop()))
      )
  );
  checkGraphSize(budget.app, "app shell static graph", applicationFiles, assets, budget.appShellMaxBytes);
  const styles = new Set(
    [...initial]
      .flatMap((key) => manifest[key].css ?? [])
      .filter((file) => !budget.entries.some((entry) => entry.pattern.test(file.split("/").pop())))
  );
  checkGraphSize(budget.app, "initial styles", styles, assets, budget.stylesMaxBytes);

  // Shared dependencies can make an optional engine eager even when its own
  // chunk is small enough. Check both the shell and the lazily loaded 2D map.
  if (budget.app === "cop-web") {
    const mapKeys = Object.keys(manifest).filter((key) =>
      /^assets\/(?:CopMap|PublicFloodDemo)-[^/]+\.js$/u.test(manifest[key]?.file)
    );
    const publicDemo = manifest["src/PublicFloodDemo.tsx"];
    if (!publicDemo) {
      hasFailure = true;
      console.error("Bundle budget: cop-web manifest nemá veřejné 2D demo.");
    }
    const roots = [...entryKeys, ...mapKeys, ...(publicDemo ? ["src/PublicFloodDemo.tsx"] : [])];
    checkOptionalEngines(
      manifest,
      staticGraph(manifest, roots, budget.app),
      budget.app,
      /(?:^|\/)(?:cesium|GlobeWorkspace|XrWorkspace)-[^/]+\.js$/u,
      "2D statický graf"
    );
  } else {
    checkOptionalEngines(
      manifest,
      initial,
      budget.app,
      /(?:^|\/)(?:matrix-|matrix_sdk_crypto_|pdf-|pdf\.worker-|jszip\.min-)/u,
      "počáteční statický graf"
    );
  }
}

function staticGraph(manifest, roots, app) {
  const visited = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    const chunk = manifest[key];
    if (
      !chunk ||
      typeof chunk.file !== "string" ||
      !/^assets\/[^/]+$/u.test(chunk.file) ||
      chunk.file.includes("\\") ||
      (chunk.imports !== undefined &&
        (!Array.isArray(chunk.imports) || chunk.imports.some((item) => typeof item !== "string"))) ||
      (chunk.css !== undefined && (!Array.isArray(chunk.css) || chunk.css.some((item) => typeof item !== "string")))
    ) {
      hasFailure = true;
      console.error(`Bundle budget: ${app} odkazuje na chybějící nebo neplatný chunk ${key}.`);
      continue;
    }
    visited.add(key);
    pending.push(...(chunk.imports ?? []));
  }
  return visited;
}

function checkGraphSize(app, label, files, assets, maxBytes) {
  let total = 0;
  if (files.size === 0) {
    hasFailure = true;
    console.error(`✗ ${app}: ${label} nemá artefakty.`);
    return;
  }
  for (const file of files) {
    const asset = assets.find((item) => file === `assets/${item.name}`);
    if (!asset) {
      hasFailure = true;
      console.error(`✗ ${app}: ${label} odkazuje na chybějící artefakt ${file}.`);
      continue;
    }
    total += asset.size;
  }
  const line = `${total <= maxBytes ? "✓" : "✗"} ${app}: ${label} (${files.size} artefaktů) ${formatBytes(total)} gzip / ${formatBytes(maxBytes)} gzip`;
  if (total <= maxBytes) console.log(line);
  else {
    hasFailure = true;
    console.error(line);
  }
}

function checkOptionalEngines(manifest, graph, app, pattern, label) {
  const eager = [...graph].map((key) => manifest[key].file).filter((file) => pattern.test(file));
  if (eager.length > 0) {
    hasFailure = true;
    console.error(`✗ ${app}: ${label} obsahuje volitelný engine ${eager.join(", ")}.`);
  } else {
    console.log(`✓ ${app}: ${label} neobsahuje volitelné enginy.`);
  }
}

if (hasFailure) {
  process.exitCode = 1;
}

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
    entries: [
      { label: "app shell", pattern: /^index-[\w-]+\.js$/, maxBytes: 340 * KiB },
      { label: "maplibre", pattern: /^maplibre-[\w-]+\.js$/, maxBytes: 330 * KiB },
      { label: "milsymbol", pattern: /^milsymbol-[\w-]+\.js$/, maxBytes: 230 * KiB },
      { label: "pairing QR generator", pattern: /^qrcode-[\w-]+\.js$/, maxBytes: 30 * KiB },
      { label: "styles", pattern: /^index-[\w-]+\.css$/, maxBytes: 35 * KiB },
      { label: "maplibre styles", pattern: /^maplibre-[\w-]+\.css$/, maxBytes: 15 * KiB }
    ]
  },
  {
    app: "cop-chat",
    dir: "apps/cop-chat/dist/assets",
    required: true,
    entries: [
      { label: "app shell", pattern: /^index-[\w-]+\.js$/, maxBytes: 130 * KiB },
      { label: "matrix sdk", pattern: /^matrix-[\w-]+\.js$/, maxBytes: 380 * KiB },
      { label: "matrix crypto wasm", pattern: /^matrix_sdk_crypto_wasm_bg-[\w-]+\.wasm$/, maxBytes: 1_950 * KiB },
      { label: "pdf viewer", pattern: /^pdf-[\w-]+\.js$/, maxBytes: 145 * KiB },
      { label: "pdf worker", pattern: /^pdf\.worker-[\w-]+\.mjs$/, maxBytes: 500 * KiB },
      { label: "office/archive parser", pattern: /^jszip\.min-[\w-]+\.js$/, maxBytes: 35 * KiB },
      { label: "styles", pattern: /^index-[\w-]+\.css$/, maxBytes: 15 * KiB }
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
    return readdirSync(absoluteDir).map((name) => ({
      name,
      path: join(absoluteDir, name),
      size: gzipSync(readFileSync(join(absoluteDir, name))).length
    }));
  } catch (error) {
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
});

if (hasFailure) {
  process.exitCode = 1;
}

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const inputs = [
  "scripts/check-public-analytics.mjs",
  "apps/cop-web/src/public-analytics.ts",
  "apps/cop-web/src/PublicFloodDemo.tsx",
  "apps/cop-web/public/cop-service-worker.js",
  "apps/cop-web/public/analytics/v1/tracker.js",
  "docker-compose.yml",
  "Dockerfile.web",
  "AGENTS.md",
  "CLAUDE.md"
];
function check(change?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "cop-analytics-release-"));
  try {
    for (const path of inputs) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      copyFileSync(path, join(root, path));
    }
    change?.(root);
    const env = { ...process.env, COP_PUBLIC_ANALYTICS_ENABLED: "false", VITE_COP_PUBLIC_ANALYTICS_ENABLED: "false" };
    return spawnSync(process.execPath, ["scripts/check-public-analytics.mjs"], { cwd: root, env, encoding: "utf8" })
      .status;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function replace(root: string, file: string, from: string, to: string) {
  const path = join(root, file);
  const source = readFileSync(path, "utf8");
  expect(source).toContain(from);
  writeFileSync(path, source.replace(from, to));
}
describe("analytics release integration cannot disappear silently", () => {
  it("accepts the exact prepared default-off integration", () => {
    expect(check()).toBe(0);
  });
  it("rejects missing bridge", () => {
    expect(check((root) => rmSync(join(root, inputs[1])))).not.toBe(0);
  });
  it("rejects a removed mount even if its import remains", () => {
    expect(
      check((root) => replace(root, inputs[2], "    observePublicDemoPageview();", "    // mount removed"))
    ).not.toBe(0);
  });
  it("rejects a changed shared runtime", () => {
    expect(check((root) => writeFileSync(join(root, inputs[4]), "// different runtime"))).not.toBe(0);
  });
  it("rejects removal of PWA exclusion", () => {
    expect(
      check((root) =>
        replace(root, inputs[3], 'url.pathname.startsWith("/analytics/")', 'url.pathname.startsWith("/other/")')
      )
    ).not.toBe(0);
  });
  it("rejects bypass of the image build guard", () => {
    expect(check((root) => replace(root, "Dockerfile.web", "RUN pnpm check:analytics &&", "RUN"))).not.toBe(0);
  });
  it("rejects auto-enabled defaults", () => {
    expect(
      check((root) =>
        replace(root, "docker-compose.yml", "COP_PUBLIC_ANALYTICS_ENABLED:-false", "COP_PUBLIC_ANALYTICS_ENABLED:-true")
      )
    ).not.toBe(0);
  });
});

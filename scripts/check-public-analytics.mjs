import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const bridge = readFileSync("apps/cop-web/src/public-analytics.ts", "utf8");
const demo = readFileSync("apps/cop-web/src/PublicFloodDemo.tsx", "utf8");
const compose = readFileSync("docker-compose.yml", "utf8");
const dockerfile = readFileSync("Dockerfile.web", "utf8");
assert.match(bridge, /publicAnalyticsPaths = \["\/demo\/flood-central-bohemia"\]/u);
assert.match(bridge, /allowedEvents: \[\],\s+autoPageview: false/u);
assert.match(bridge, /autoClick: false,\s+captureTitle: false,\s+captureReferrer: false/u);
assert.match(bridge, /credentials: "omit",\s+offline: "discard"/u);
assert.match(demo, /observePublicDemoPageview/u);
assert.match(compose, /COP_PUBLIC_ANALYTICS_ENABLED:-false/u);
assert.match(dockerfile, /ARG VITE_COP_PUBLIC_ANALYTICS_ENABLED=false/u);
assert.equal(readFileSync("AGENTS.md", "utf8"), readFileSync("CLAUDE.md", "utf8"));


const runtime = readFileSync("apps/cop-web/public/analytics/v1/tracker.js");
const sri = "sha384-" + createHash("sha384").update(runtime).digest("base64");
assert.ok(bridge.includes(sri), "Pinned runtime SRI must match the deployed artifact");

if (process.env.VITE_COP_PUBLIC_ANALYTICS_ENABLED === "true" || process.env.COP_PUBLIC_ANALYTICS_ENABLED === "true") {
  assert.match(runtime.toString(), /referrerPolicy\s*:\s*["']no-referrer["']/u,
    "Activation blocked: shared runtime must suppress browser Referer");
}
console.log("Public demo analytics integration/default-off release guards passed");

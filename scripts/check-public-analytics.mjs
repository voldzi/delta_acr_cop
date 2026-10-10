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
assert.match(
  demo,
  /React\.useEffect\(\(\) => \{\s+observePublicDemoPageview\(\)/u,
  "Public demo mount must invoke the bridge"
);
assert.match(demo, /<PublicAnalyticsNotice\s*\/>/u, "Keep the gated privacy notice in the demo");
assert.match(
  readFileSync("apps/cop-web/public/cop-service-worker.js", "utf8"),
  /url\.pathname\.startsWith\("\/analytics\/"\)/u,
  "Analytics must bypass PWA caching"
);
assert.match(compose, /COP_PUBLIC_ANALYTICS_ENABLED:-false/u);
assert.match(dockerfile, /ARG VITE_COP_PUBLIC_ANALYTICS_ENABLED=false/u);
assert.match(
  dockerfile,
  /RUN pnpm check:analytics && pnpm --filter @cop\/cop-web/u,
  "Web image build must invoke release guard"
);
assert.equal(readFileSync("AGENTS.md", "utf8"), readFileSync("CLAUDE.md", "utf8"));

assert.ok(readFileSync("apps/cop-web/public/cop-service-worker.js", "utf8").includes('url.pathname === "/vcode-analytics-tiktok.js"'), "Vendored analytics runtime must bypass PWA caching");
const runtime = readFileSync("apps/cop-web/public/analytics/v1/tracker.js");
const sri = "sha384-" + createHash("sha384").update(runtime).digest("base64");
assert.equal(
  sri,
  "sha384-lhej7Cxih2xEDtoPqh2B7mI4JilbkjF9HtVj+agiDEv8P6XAO98U6FJUCNpIVsMN",
  "Preserve the previous v1 compatibility artifact"
);
const v2Integrity = "sha384-JpAOJexapVVtAZAFpz3dwp4AHY8PLbao7cLk7Mg7VFIDy2g0/bOUl0zb/HO1qbX5";
assert.ok(bridge.includes(v2Integrity), "Pin the reviewed shared v2 runtime");
assert.match(bridge, /vcode-public-v2/u);
assert.match(bridge, /captureSources: true/u);
assert.match(bridge, /\/vcode-analytics-tiktok\.js/u);
assert.match(bridge, /analytics\/v2\/events/u);
assert.match(bridge, /environment\.anonymous\(\)/u);

{
  const v2Runtime = readFileSync("apps/cop-web/public/vcode-analytics-tiktok.js");
  assert.equal(
    "sha384-" + createHash("sha384").update(v2Runtime).digest("base64"),
    v2Integrity,
    "Actual shared v2 bytes must match SRI"
  );
  assert.match(
    v2Runtime.toString(),
    /referrerPolicy\s*:\s*["']no-referrer["']/u,
    "Activation blocked: shared runtime must suppress browser Referer"
  );
}
console.log("Public demo analytics integration/default-off release guards passed");

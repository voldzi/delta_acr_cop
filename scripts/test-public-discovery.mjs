import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cop-discovery-"));
await fs.copyFile("apps/cop-web/server.mjs", path.join(dir, "server.mjs"));
await fs.cp("apps/cop-web/public", path.join(dir, "dist"), { recursive: true });
await fs.copyFile("apps/cop-web/index.html", path.join(dir, "dist/index.html"));
const child = spawn(process.execPath, [path.join(dir, "server.mjs")], {
  env: { ...process.env, COP_WEB_PORT: "49318", COP_WEB_ALLOWED_HOSTS: "cop.zeleznalady.cz" },
  stdio: "ignore"
});
const base = "http://127.0.0.1:49318";
try {
  for (let n = 0; n < 50; n++) {
    try {
      if ((await fetch(base + "/health/live")).ok) break;
    } catch {}
    await delay(100);
  }
  let checks = 0;
  for (const [url, status] of [
    ["/", 200],
    ["/o-aplikaci/", 200],
    ["/demo/flood-central-bohemia", 200],
    ["/xr", 200],
    ["/globe", 200],
    ["/chat/", 200],
    ["/mobile/pair/demo", 200],
    ["/missing-page", 404],
    ["/missing.js", 404],
    ["/robots.txt", 200],
    ["/sitemap.xml", 200],
    ["/llms.txt", 200],
    ["/google3a8915cd90e394a1.html", 200]
  ]) {
    assert.equal((await fetch(base + url)).status, status, url);
    checks++;
  }
  const landing = await (await fetch(base + "/o-aplikaci/")).text();
  assert.match(landing, /<h1>/);
  assert.match(landing, /application\/ld\+json/);
  assert.match(landing, /SYNTETICKÁ DATA/);
  assert.doesNotMatch(landing, /<script(?! type="application\/ld\+json")/);
  checks++;
  assert.match(await (await fetch(base + "/")).text(), /noindex,follow/);
  checks++;
  const demo = await (await fetch(base + "/demo/flood-central-bohemia")).text();
  assert.match(demo, /content="index,follow"/);
  assert.match(demo, /rel="canonical" href="https:\/\/cop.zeleznalady.cz\/demo\/flood-central-bohemia"/);
  checks++;
  for (const url of ["/o-aplikaci/", "/demo/flood-central-bohemia", "/sitemap.xml"]) {
    const h = await fetch(base + url, { method: "HEAD" });
    assert.equal(h.status, 200);
    assert.equal(await h.text(), "");
    checks++;
  }
  const redirect = await fetch(base + "/o-aplikaci", { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/o-aplikaci/");
  checks++;
  assert.match((await fetch(base + "/sitemap.xml")).headers.get("content-type"), /application\/xml/);
  assert.match((await fetch(base + "/robots.txt")).headers.get("content-type"), /text\/plain/);
  checks++;
  const blocked = await new Promise((resolve, reject) => {
    const req = http.get(base + "/", { headers: { host: "attacker.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
  });
  assert.equal(blocked, 403);
  checks++;
  const robots = await (await fetch(base + "/robots.txt")).text();
  assert.match(robots, /User-agent: GPTBot\nDisallow: \//);
  assert.match(robots, /User-agent: OAI-SearchBot/);
  checks++;
  console.log(
    JSON.stringify({
      passed: checks,
      scope:
        "Actual HTTP static content, metadata, HEAD, fallback, host guard and crawler rules; no provider calls or analytics POSTs"
    })
  );
} finally {
  child.kill();
  await fs.rm(dir, { recursive: true, force: true });
}

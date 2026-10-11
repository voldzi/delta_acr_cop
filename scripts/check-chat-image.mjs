#!/usr/bin/env node
// Run inside the exact candidate image, read-only and without external network.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.getuid(), 1000, "Chat must run as the unprivileged node user");
assert.equal(process.cwd(), "/app/apps/cop-chat");
assert.equal(existsSync("/app/node_modules"), false, "Do not ship build dependencies");
assert.equal(existsSync("node_modules"), false);
assert.equal(existsSync("dist/index.html"), true);
const child = spawn(process.execPath, ["server.mjs"], {
  env: { ...process.env, COP_CHAT_PORT: "49314", COP_CHAT_ALLOWED_HOSTS: "127.0.0.1,localhost" },
  stdio: "ignore"
});
try {
  let started = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:49314/health/live", { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.status === 200) {
        started = true;
        break;
      }
    } catch {
      /* Wait only for this child server. */
    }
    if (child.exitCode !== null) throw new Error("Chat server exited before becoming ready");
    await delay(100);
  }
  assert.equal(started, true, "Chat server did not become ready");
  for (const [route, status] of [
    ["/chat/", 200],
    ["/chat/conversation", 200],
    ["/chat/assets/__missing__.js", 404],
    ["/chat/oidc/token", 405]
  ]) {
    const response = await fetch(`http://127.0.0.1:49314${route}`, { signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    assert.equal(response.status, status, `Unexpected status for ${route}`);
  }
  console.log(JSON.stringify({ chatImageStartup: "passed", uid: process.getuid(), buildDependenciesAbsent: true }));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  });
}

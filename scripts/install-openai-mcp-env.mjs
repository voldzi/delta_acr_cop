import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [pendingPath, envPath] = process.argv.slice(2).map((path) => resolve(path));
if (!pendingPath || !envPath || !existsSync(pendingPath) || !existsSync(envPath)) {
  throw new Error("Expected existing pending key file and production env file.");
}

const pending = readFileSync(pendingPath, "utf8");
const match = /^OPENAI_API_KEY=(sk-[^\s]+)$/m.exec(pending);
if (!match || pending.trim().split("\n").length !== 1) {
  throw new Error("Pending key file must contain exactly one OPENAI_API_KEY entry.");
}

// Production callers hold the same COP lock throughout this installation.
// Python validates the inherited descriptor and mount; never retain an env
// backup beside the production env or reveal helper/secret contents.
const production = envPath === "/srv/cop/.env";
function productionStorage(command) {
  const fd = Number(process.env.COP_STORAGE_LOCK_FD);
  if (!Number.isInteger(fd) || fd < 3 || fd > 32) {
    throw new Error("Production install requires the COP storage operation lock; see X5 runbook.");
  }
  const stdio = Array.from({ length: fd + 1 }, () => "ignore");
  stdio[fd] = fd;
  const compose = ["docker-compose.yml", "docker-compose.driver-measurements.yml", "docker-compose.x5.yml"];
  if (existsSync("/srv/cop/docker-compose.ai-router.yml")) compose.push("docker-compose.ai-router.yml");
  const args = ["/srv/cop/scripts/cop-storage.py", command];
  if (command === "snapshot") for (const file of compose) args.push("--compose-file", file);
  const result = spawnSync("python3", args, { cwd: "/srv/cop", stdio });
  if (result.error || result.status !== 0) throw new Error("COP X5 storage guard/snapshot failed; env unchanged.");
}
if (production) productionStorage("snapshot");

const oldEnv = readFileSync(envPath, "utf8");
const updates = new Map([
  ["OPENAI_API_KEY", match[1]],
  ["COP_OPENAI_MCP_ENABLED", "true"],
  ["COP_OPENAI_MCP_DAILY_USD", "1"],
  ["COP_OPENAI_MCP_MONTHLY_USD", "10"],
  ["COP_OPENAI_MCP_DAILY_TOKENS", "100000"],
  ["COP_OPENAI_MCP_MONTHLY_TOKENS", "1000000"],
  ["COP_OPENAI_MCP_USER_DAILY_REQUESTS", "10"]
]);
const lines = oldEnv.split("\n");
for (let index = 0; index < lines.length; index += 1) {
  const key = /^([A-Z][A-Z0-9_]*)=/.exec(lines[index])?.[1];
  if (key && updates.has(key)) {
    lines[index] = `${key}=${updates.get(key)}`;
    updates.delete(key);
  }
}
if (updates.size > 0) {
  if (lines.at(-1) !== "") lines.push("");
  for (const [key, value] of updates) lines.push(`${key}=${value}`);
  lines.push("");
}

const backup = `${envPath}.pre-openai-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
const temporary = join(dirname(envPath), `.env.openai-${process.pid}.tmp`);
if (!production) {
  copyFileSync(envPath, backup);
  chmodSync(backup, 0o600);
}
try {
  writeFileSync(temporary, lines.join("\n"), { mode: 0o600, flag: "wx" });
  if (production) productionStorage("preflight");
  renameSync(temporary, envPath);
  chmodSync(envPath, 0o600);
  rmSync(pendingPath);
} catch (error) {
  rmSync(temporary, { force: true });
  throw error;
}
console.log("OpenAI MCP configuration installed; previous env backed up. No secret was printed.");

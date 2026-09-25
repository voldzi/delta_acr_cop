import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [pendingPath, envPath] = process.argv.slice(2).map((path) => resolve(path));
if (!pendingPath || !envPath || !existsSync(pendingPath) || !existsSync(envPath)) {
  throw new Error("Expected existing pending key file and production env file.");
}

const pending = readFileSync(pendingPath, "utf8");
const match = /^OPENAI_API_KEY=(sk-[^\s]+)$/m.exec(pending);
if (!match || pending.trim().split("\n").length !== 1) {
  throw new Error("Pending key file must contain exactly one OPENAI_API_KEY entry.");
}

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
copyFileSync(envPath, backup);
chmodSync(backup, 0o600);
try {
  writeFileSync(temporary, lines.join("\n"), { mode: 0o600, flag: "wx" });
  renameSync(temporary, envPath);
  chmodSync(envPath, 0o600);
  rmSync(pendingPath);
} catch (error) {
  rmSync(temporary, { force: true });
  throw error;
}
console.log("OpenAI MCP configuration installed; previous env backed up. No secret was printed.");

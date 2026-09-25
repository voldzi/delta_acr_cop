import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production OpenAI env installer", () => {
  it("updates only approved settings, keeps backup and removes pending key", () => {
    const folder = mkdtempSync(join(tmpdir(), "cop-openai-env-"));
    const pending = join(folder, ".pending");
    const env = join(folder, ".env");
    try {
      writeFileSync(pending, "OPENAI_API_KEY=sk-test-placeholder\n", { mode: 0o600 });
      writeFileSync(env, "COP_DATABASE_URL=postgres://example\nCOP_OPENAI_MCP_ENABLED=false\n", { mode: 0o600 });
      const output = execFileSync(process.execPath, [join(import.meta.dirname, "../../../scripts/install-openai-mcp-env.mjs"), pending, env], { encoding: "utf8" });
      expect(output).not.toContain("sk-test-placeholder");
      expect(existsSync(pending)).toBe(false);
      const installed = readFileSync(env, "utf8");
      expect(installed).toContain("OPENAI_API_KEY=sk-test-placeholder");
      expect(installed).toContain("COP_DATABASE_URL=postgres://example");
      expect(installed).toContain("COP_OPENAI_MCP_ENABLED=true");
      expect(installed).toContain("COP_OPENAI_MCP_DAILY_USD=1");
      expect(statSync(env).mode & 0o777).toBe(0o600);
      expect(readdirSync(folder).some((name) => name.startsWith(".env.pre-openai-"))).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

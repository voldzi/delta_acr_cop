import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const enabled = process.env.COP_RUN_WHOLE_ACCOUNT_ERASURE_FIXTURE === "true";
const manifest = process.env.COP_WHOLE_ACCOUNT_ERASURE_FIXTURE;
if (enabled && !manifest) throw new Error("WHOLE_FIXTURE_MANIFEST_REQUIRED");

describe.skipIf(!enabled)("whole account acceptance through actual isolated providers", () => {
  it("requires complete real provider acceptance including restore; a component result cannot pass", async () => {
    const result = await promisify(execFile)("/usr/bin/python3", ["scripts/test-account-erasure-whole-joint.py", "--run", "--manifest", manifest!], {
      cwd: new URL("../../../", import.meta.url), timeout: 10_800_000, maxBuffer: 64 * 1024
    });
    const records = result.stdout.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
    const final = records.at(-1);
    expect(final).toMatchObject({ phase: "whole_account_acceptance_complete", wholeAccountAccepted: true, productionChanged: false });
    expect(final?.actualOwners).toEqual(expect.arrayContaining(["keycloak", "cop_sessions_profiles", "cop_devices", "messaging_matrix", "voice_livekit",
      "cop_content_media", "mobility_dispatch", "sim_measurements", "ai_router", "moderation_audit", "backup_restore"]));
  }, 10_810_000);
});

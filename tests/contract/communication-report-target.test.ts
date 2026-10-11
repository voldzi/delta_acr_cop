import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAjv } from "../../packages/ingest-contracts/src/index.js";
import { COMMUNICATION_RETENTION_POLICY_ID, CommunicationSafetyService } from "../../apps/cop-api/src/communication-safety.js";
import { MemoryMobilityStore } from "../../apps/cop-api/src/mobility-store.js";

const openapi = JSON.parse(readFileSync(new URL("../../openapi/openapi.json", import.meta.url), "utf8"));
const compile = (name: string) => createAjv().compile(openapi.components.schemas[name]);

describe("Communication report contract", () => {
  it("aligns ASCII peer and conversation bounds at 256 and 255", () => {
    const validate = compile("CommunicationReportTarget");
    const target = { kind: "user", peerSubjectId: "p".repeat(256), conversationId: "c".repeat(255) };
    expect(validate(target)).toBe(true);
    expect(validate({ ...target, peerSubjectId: "p".repeat(257) })).toBe(false);
    expect(validate({ ...target, conversationId: "c".repeat(256) })).toBe(false);
  });

  it("keeps message event references at 255 and rejects extra target fields", () => {
    const validate = compile("CommunicationReportTarget");
    const target = { kind: "message", peerSubjectId: "peer", conversationId: "conversation", eventId: "$" + "e".repeat(254) };
    expect(validate(target)).toBe(true);
    expect(validate({ ...target, eventId: "$" + "e".repeat(255) })).toBe(false);
    expect(validate({ ...target, eventId: "e" })).toBe(false);
    expect(validate({ ...target, roomId: "!untrusted:test" })).toBe(false);
  });

  it("requires a resolution exactly when a report receipt is resolved", () => {
    const validate = compile("CommunicationReportReceipt");
    const receipt = { reportId: "e6450609-cbe5-4c9c-adfa-598db1d125ef", createdAt: "2026-10-11T00:00:00.000Z", revision: 1 };
    for (const status of ["submitted", "reviewing"]) {
      expect(validate({ ...receipt, status })).toBe(true);
      expect(validate({ ...receipt, status, resolution: "no_action" })).toBe(false);
    }
    for (const resolution of ["no_action", "action_taken"]) expect(validate({ ...receipt, status: "resolved", resolution })).toBe(true);
    expect(validate({ ...receipt, status: "resolved" })).toBe(false);
    expect(validate({ ...receipt, status: "resolved", resolution: "unknown" })).toBe(false);
  });

  it("requires a resolution exactly when the operator marks the review resolved", () => {
    const validate = compile("CommunicationReportReview");
    const review = { expectedRevision: 1 };
    expect(validate({ ...review, status: "reviewing" })).toBe(true);
    expect(validate({ ...review, status: "reviewing", resolution: "action_taken" })).toBe(false);
    for (const resolution of ["no_action", "action_taken"]) expect(validate({ ...review, status: "resolved", resolution })).toBe(true);
    expect(validate({ ...review, status: "resolved" })).toBe(false);
    expect(validate({ ...review, status: "submitted" })).toBe(false);
  });

  it("validates the actual retained moderator response and keeps private storage fields outside the contract", async () => {
    const day = 86_400_000; let now = Date.parse("2026-01-01T00:00:00Z");
    const service = new CommunicationSafetyService({ store: new MemoryMobilityStore(),
      encryptionSecret: "synthetic-contract-retention-secret-32-plus", moderatorRole: "synthetic-moderator",
      contactEmail: "podpora@zeleznalady.cz", retentionPolicyId: COMMUNICATION_RETENTION_POLICY_ID, now: () => new Date(now),
      policy: { block: async () => true, directAllowed: async () => true, eventMatchesPeer: async () => true }, validateTarget: async () => {} });
    const actor = { authMode: "oidc" as const, issuer: "https://identity.test/cop", subjectId: "synthetic-owner", displayName: "", username: "" };
    const receipt = await service.submit(actor, { target: { kind: "user", peerSubjectId: "synthetic-peer", conversationId: "synthetic-room" },
      reason: "spam", evidence: { selectedText: "Synthetic selected excerpt", explicitlyConfirmed: true } }, "synthetic-contract-operation");
    now += 10 * day;
    await service.review(actor, receipt.reportId, { expectedRevision: 1, status: "resolved", resolution: "no_action" });
    const schema = structuredClone(openapi.components.schemas.CommunicationReportOperatorRecord);
    schema.properties.target = openapi.components.schemas.CommunicationReportTarget;
    schema.properties.evidence = openapi.components.schemas.CommunicationReportEvidence;
    const validate = createAjv().compile(schema);
    const detail = await service.read(actor, receipt.reportId, true);
    expect(validate(detail), JSON.stringify(validate.errors)).toBe(true);
    expect(detail).not.toHaveProperty("ownerKey"); expect(detail).not.toHaveProperty("provenance");
    expect(validate({ ...detail, ownerKey: "internal-owner" })).toBe(false);
    now += 30 * day;
    const expiredEvidence = await service.read(actor, receipt.reportId, true);
    expect(validate(expiredEvidence), JSON.stringify(validate.errors)).toBe(true);
    expect(expiredEvidence).not.toHaveProperty("evidence");
    now = Date.parse("2026-01-01T00:00:00Z") + 180 * day;
    await expect(service.read(actor, receipt.reportId, true)).rejects.toMatchObject({ status: 410, code: "REPORT_DETAIL_EXPIRED" });
    expect(openapi.paths["/api/v1/moderation/communication/reports/{reportId}"].get.responses["410"]).toBeDefined();
    expect(compile("CommunicationReportReceipt")(await service.read(actor, receipt.reportId))).toBe(true);
  });
});

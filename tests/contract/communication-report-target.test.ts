import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAjv } from "../../packages/ingest-contracts/src/index.js";

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
});

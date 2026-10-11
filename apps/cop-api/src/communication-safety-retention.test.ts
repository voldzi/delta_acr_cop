import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { COMMUNICATION_RETENTION_POLICY_ID, CommunicationSafetyService, registerCommunicationSafetyRoutes } from "./communication-safety.js";
import { MemoryMobilityStore, type MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

const epoch = Date.parse("2026-01-01T00:00:00.000Z"), day = 86_400_000;
const secret = "synthetic-test-retention-secret-32-characters";
const actor = (subjectId = "synthetic-owner"): AuthenticatedActor => ({ subjectId, issuer: "https://identity.test/cop",
  authMode: "oidc", displayName: "Synthetic", username: "Synthetic" });
const input = { target: { kind: "message" as const, peerSubjectId: "synthetic-peer", conversationId: "synthetic-room", eventId: "$synthetic-event" },
  reason: "harassment" as const, evidence: { selectedText: "SYNTHETIC_EXPLICIT_PRIVATE_EXCERPT", explicitlyConfirmed: true as const } };
const operation = "synthetic-operation-000001";
function fixture(store = new MemoryMobilityStore()) {
  let instant = epoch;
  const validateTarget = vi.fn(async () => {});
  const policy = { block: vi.fn(async () => true), directAllowed: vi.fn(async () => false), eventMatchesPeer: vi.fn(async () => true) };
  const options = { store, policy, validateTarget, encryptionSecret: secret, moderatorRole: "synthetic-moderator",
    contactEmail: "moderation@example.test", retentionPolicyId: COMMUNICATION_RETENTION_POLICY_ID, now: () => new Date(instant) };
  const service = new CommunicationSafetyService(options);
  return { store, service, options, validateTarget, at(days: number, offset = 0) { instant = epoch + days * day + offset; } };
}
type InspectedReport = { evidence?: { selectedText: string }; target?: unknown; reason?: string; reporter?: string; reporterIssuer?: string;
  audit: { actor: string; at: string; action: string }[]; closedAt?: string; evidenceExpiresAt: string; detailsExpiredAt?: string;
  ownerKey: string; provenance: { retentionPolicyId: string }; status: string; revision: number; resolution?: string };
function open(sealed: string): InspectedReport {
  const bytes = Buffer.from(sealed, "base64"), key = createHash("sha256").update("cop-communication-reports-v1\0").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as InspectedReport;
}
function seal(value: InspectedReport): string {
  const iv = randomBytes(12), key = createHash("sha256").update("cop-communication-reports-v1\0").update(secret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv), bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
}
async function inspect(store: MemoryMobilityStore, id: string): Promise<InspectedReport> {
  const row = await store.transact([], tx => tx.get<{ sealed: string }>("communication-safety:report:" + id)); return open(row!.sealed);
}

describe("approved communication retention", () => {
  it("requires the exact approved policy id and publishes it without enabling whole-account erasure", () => {
    const f = fixture(); expect(f.service.capabilities()).toMatchObject({ retentionPolicyId: COMMUNICATION_RETENTION_POLICY_ID, accountDeletion: false });
    expect(() => new CommunicationSafetyService({ ...f.options, retentionPolicyId: "unknown-policy" })).toThrow();
  });

  it("purges selected text at the exact 90-day boundary on read, without waiting for a worker", async () => {
    const f = fixture(), receipt = await f.service.submit(actor(), input, operation);
    f.at(90, -1); expect(await f.service.read(actor("moderator"), receipt.reportId, true)).toHaveProperty("evidence.selectedText", input.evidence.selectedText);
    f.at(90); expect(await f.service.read(actor("moderator"), receipt.reportId, true)).not.toHaveProperty("evidence");
    const stored = await inspect(f.store, receipt.reportId); expect(stored).not.toHaveProperty("evidence");
    expect(JSON.stringify(stored)).not.toContain(input.evidence.selectedText);
    f.validateTarget.mockRejectedValue(new Error("synthetic target was removed"));
    expect(await f.service.submit(actor(), input, operation)).toEqual(receipt);
    expect(await inspect(f.store, receipt.reportId)).not.toHaveProperty("evidence");
    expect(f.validateTarget).toHaveBeenCalledTimes(1);
  });

  it("uses the earlier 30-day closure deadline and never extends it on a rejected reopening", async () => {
    const f = fixture(), receipt = await f.service.submit(actor(), input, operation);
    f.at(10); await f.service.review(actor("moderator"), receipt.reportId, { expectedRevision: 1, status: "resolved", resolution: "action_taken" });
    const closed = await inspect(f.store, receipt.reportId); expect(closed.closedAt).toBe(new Date(epoch + 10 * day).toISOString());
    expect(closed.evidenceExpiresAt).toBe(new Date(epoch + 40 * day).toISOString());
    f.at(39); await expect(f.service.review(actor("moderator"), receipt.reportId, { expectedRevision: 2, status: "reviewing" })).rejects.toMatchObject({ status: 409 });
    f.at(40); await expect(f.service.review(actor("moderator"), receipt.reportId, { expectedRevision: 2, status: "reviewing" })).rejects.toMatchObject({ status: 409 });
    expect(await inspect(f.store, receipt.reportId)).not.toHaveProperty("evidence");
    expect((await inspect(f.store, receipt.reportId)).closedAt).toBe(closed.closedAt);
  });

  it("keeps the original 90-day maximum after late closure and a migrated historical reopening", async () => {
    const f = fixture(), receipt = await f.service.submit(actor(), input, operation);
    f.at(80); await f.service.review(actor("moderator"), receipt.reportId, { expectedRevision: 1, status: "resolved", resolution: "no_action" });
    expect((await inspect(f.store, receipt.reportId)).evidenceExpiresAt).toBe(new Date(epoch + 90 * day).toISOString());
    const migrated = await inspect(f.store, receipt.reportId); migrated.status = "reviewing"; delete migrated.resolution;
    await f.store.transact([], tx => tx.set("communication-safety:report:" + receipt.reportId, { sealed: seal(migrated) }));
    f.at(85); await f.service.review(actor("moderator"), receipt.reportId, { expectedRevision: 2, status: "resolved", resolution: "no_action" });
    const updated = await inspect(f.store, receipt.reportId); expect(updated.closedAt).toBe(new Date(epoch + 80 * day).toISOString());
    expect(updated.evidenceExpiresAt).toBe(new Date(epoch + 90 * day).toISOString());
    f.at(90); await f.service.pruneExpired(); expect(await inspect(f.store, receipt.reportId)).not.toHaveProperty("evidence");
  });

  it("recovers the earliest historical closure from the audit without extending the deadline", async () => {
    const f = fixture(), receipt = await f.service.submit(actor(), input, operation);
    f.at(10); await f.service.review(actor("moderator"), receipt.reportId, { expectedRevision: 1, status: "resolved", resolution: "no_action" });
    const legacy = await inspect(f.store, receipt.reportId); delete legacy.closedAt;
    legacy.evidenceExpiresAt = new Date(epoch + 90 * day).toISOString();
    await f.store.transact([], tx => tx.set("communication-safety:report:" + receipt.reportId, { sealed: seal(legacy) }));
    f.at(40); expect(await f.service.read(actor("moderator"), receipt.reportId, true)).not.toHaveProperty("evidence");
    expect((await inspect(f.store, receipt.reportId)).closedAt).toBe(new Date(epoch + 10 * day).toISOString());
  });

  it("compacts the 180-day report body/audit into a content-free own receipt with idempotency and provenance", async () => {
    const f = fixture(), receipt = await f.service.submit(actor(), input, operation);
    f.at(20); const reviewed = await f.service.review(actor("moderator"), receipt.reportId, { expectedRevision: 1, status: "reviewing" });
    expect(JSON.stringify((await inspect(f.store, receipt.reportId)).audit)).not.toContain(input.evidence.selectedText);
    f.at(180); await expect(f.service.read(actor("moderator"), receipt.reportId, true)).rejects.toMatchObject({ status: 410, code: "REPORT_DETAIL_EXPIRED" });
    const compacted = await inspect(f.store, receipt.reportId);
    for (const field of ["evidence", "target", "reason", "reporter", "reporterIssuer"]) expect(compacted).not.toHaveProperty(field);
    expect(compacted.audit).toEqual([]); expect(compacted.ownerKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(compacted.provenance.retentionPolicyId).toBe(COMMUNICATION_RETENTION_POLICY_ID);
    expect(await f.service.queue()).toEqual([]); expect(await f.service.read(actor(), receipt.reportId)).toEqual(reviewed);
    f.validateTarget.mockRejectedValue(new Error("synthetic source removed"));
    expect(await f.service.submit(actor(), input, operation)).toEqual(reviewed);
    await expect(f.service.read(actor("other-owner"), receipt.reportId)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.submit(actor(), { ...input, reason: "spam" }, operation)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.review(actor("moderator"), receipt.reportId, { expectedRevision: 2, status: "resolved", resolution: "no_action" })).rejects.toMatchObject({ status: 410 });
  });

  it("coalesces the worker and retries an atomic failed purge without leaking private error text", async () => {
    class FaultStore extends MemoryMobilityStore {
      fail = false;
      override async transact<T>(keys: string[], run: (transaction: MobilityTransaction) => Promise<T>): Promise<T> {
        return super.transact(keys, tx => run({ ...tx, set: async (key, value) => {
          if (this.fail && key === "communication-safety:pending-index") throw new Error("private failure SYNTHETIC_EXPLICIT_PRIVATE_EXCERPT");
          await tx.set(key, value);
        } }));
      }
    }
    const store = new FaultStore(), f = fixture(store), receipt = await f.service.submit(actor(), input, operation);
    f.at(180); store.fail = true;
    const first = f.service.pruneExpired(), concurrent = f.service.pruneExpired(); expect(concurrent).toBe(first);
    await expect(first).rejects.toMatchObject({ status: 503, code: "REPORT_RETENTION_UNAVAILABLE", message: "REPORT_RETENTION_UNAVAILABLE" });
    expect((await inspect(store, receipt.reportId)).evidence?.selectedText).toBe(input.evidence.selectedText);
    store.fail = false;
    expect(await f.service.pruneExpired()).toMatchObject({ reportsChanged: 1, evidencePurged: 1, detailsPurged: 1, auditEventsPurged: 1 });
    expect(await f.service.pruneExpired()).toMatchObject({ reportsChanged: 0, evidencePurged: 0, detailsPurged: 0 });
    expect(await inspect(store, receipt.reportId)).not.toHaveProperty("evidence");
    expect(f.options.policy.block).not.toHaveBeenCalled(); // Report cleanup cannot expire the canonical block policy.
  });

  it("returns no expired text over HTTP and keeps own content-free receipts while operator details are410", async () => {
    const f = fixture(), receipt = await f.service.submit(actor(), input, operation), app = Fastify();
    registerCommunicationSafetyRoutes(app, f.service, request => typeof request.headers.authorization === "string"
      ? { ...actor(request.headers.authorization), roles: request.headers.authorization === "moderator" ? ["synthetic-moderator"] : [] } : null);
    try {
      f.at(90);
      const detail = await app.inject({ url: "/api/v1/moderation/communication/reports/" + receipt.reportId, headers: { authorization: "moderator" } });
      expect(detail.statusCode).toBe(200); expect(detail.body).not.toContain(input.evidence.selectedText);
      expect(detail.json()).not.toHaveProperty("evidence"); expect(detail.json()).not.toHaveProperty("ownerKey");
      f.at(180);
      const expired = await app.inject({ url: "/api/v1/moderation/communication/reports/" + receipt.reportId, headers: { authorization: "moderator" } });
      expect(expired.statusCode).toBe(410); expect(expired.body).not.toContain(input.evidence.selectedText);
      const own = await app.inject({ url: "/api/v1/me/communication/reports/" + receipt.reportId, headers: { authorization: actor().subjectId } });
      expect(own.statusCode).toBe(200); expect(own.json()).toEqual(receipt);
      expect((await app.inject({ url: "/api/v1/me/communication/reports/" + receipt.reportId, headers: { authorization: "other-owner" } })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});

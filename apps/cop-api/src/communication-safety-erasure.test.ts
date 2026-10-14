import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { COMMUNICATION_RETENTION_POLICY_ID, CommunicationSafetyService } from "./communication-safety.js";
import { MemoryMobilityStore, type MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

const secret = "synthetic-moderation-erasure-secret-32-chars";
const actor = (subjectId: string, issuer = "https://identity.test/cop"): AuthenticatedActor => ({
  authMode: "oidc", issuer, subjectId, displayName: "Synthetic", username: "Synthetic"
});
const input = (peer = "peer") => ({ target: { kind: "user" as const, peerSubjectId: peer, conversationId: "synthetic-conversation" }, reason: "spam" as const,
  evidence: { selectedText: "SYNTHETIC_SELECTED_PRIVATE_TEXT", explicitlyConfirmed: true as const } });
function fixture(store = new MemoryMobilityStore()) {
  const validateTarget = vi.fn(async () => ({ peerIssuer: "https://identity.test/cop" }));
  const service = new CommunicationSafetyService({ store, validateTarget,
    policy: { block: vi.fn(async () => true), directAllowed: vi.fn(async () => true), eventMatchesPeer: vi.fn(async () => true) },
    encryptionSecret: secret, moderatorRole: "moderator", contactEmail: "support@example.test",
    retentionPolicyId: COMMUNICATION_RETENTION_POLICY_ID, now: () => new Date("2026-10-14T00:00:00Z") });
  return { service, store, validateTarget };
}
const context = () => ({ operationId: "b9a225df-ad60-4940-86c2-a678f970a840", signal: new AbortController().signal });
type RecordBody = { ownerKey: string; reporter?: string; reporterIssuer?: string; targetIssuer?: string;
  target?: { peerSubjectId: string }; audit: { actor: string; actorIssuer?: string }[]; evidence?: unknown; reason?: unknown };
function open(sealed: string): RecordBody {
  const bytes = Buffer.from(sealed, "base64"), key = createHash("sha256").update("cop-communication-reports-v1\0").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as RecordBody;
}
function seal(body: RecordBody): string {
  const iv = randomBytes(12), key = createHash("sha256").update("cop-communication-reports-v1\0").update(secret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv), bytes = Buffer.concat([cipher.update(JSON.stringify(body)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
}
async function mutate(store: MemoryMobilityStore, id: string, transform: (body: RecordBody) => void) {
  await store.transact([], async tx => { const key = "communication-safety:report:" + id, row = await tx.get<{ sealed: string }>(key);
    const body = open(row!.sealed); transform(body); await tx.set(key, { sealed: seal(body) }); });
}
async function bodies(store: MemoryMobilityStore) {
  return store.transact([], async tx => (await tx.scan<{ sealed: string }>("communication-safety:report:")).map(row => open(row.value.sealed)));
}

describe("COP moderation erasure", () => {
  it("removes own content and receipts, preserves another issuer and other users, and keeps an idempotent permanent fence", async () => {
    const f = fixture(), a = actor("a");
    const own = await f.service.submit(a, input(), "own-operation");
    const b = await f.service.submit(actor("b"), input(), "other-operation");
    const foreign = await f.service.submit(actor("a", "https://foreign.test/cop"), input(), "foreign-operation");
    expect(await f.service.erasurePreflight(a, context().signal)).toMatchObject({ ready: true });
    const erased = await f.service.eraseAccount(a, context()); expect(erased.status).toBe("completed");
    expect(await f.service.eraseAccount(a, context())).toEqual(erased);
    await expect(f.service.read(a, own.reportId)).rejects.toMatchObject({ status: 403 });
    expect(await f.service.read(actor("b"), b.reportId)).toEqual(b);
    expect(await f.service.read(actor("a", "https://foreign.test/cop"), foreign.reportId)).toEqual(foreign);
    await expect(f.service.submit(a, input(), "own-operation")).rejects.toMatchObject({ status: 403 });
    await expect(f.service.submit(a, input(), "new-operation")).rejects.toMatchObject({ status: 403 });
    const owner = createHash("sha256").update(JSON.stringify([a.issuer, a.subjectId])).digest("hex");
    const rows = await f.store.transact([], tx => tx.scan("communication-safety:"));
    expect(rows.filter(row => row.key.startsWith(`communication-safety:operation:${owner}:`))).toEqual([]);
    expect(rows.filter(row => row.key.startsWith(`communication-safety:rate:${owner}:`))).toEqual([]);
    expect(rows.find(row => row.key === "communication-safety:erasure-fence:" + owner)?.value).toEqual({ operationId: context().operationId, proofId: "proofId" in erased ? erased.proofId : undefined });
    expect(await bodies(f.store)).toHaveLength(2); expect(await f.service.queue()).toHaveLength(2);
  });

  it("removes the erased person's target, selected text and moderator audit links without deleting other reporters' status", async () => {
    const f = fixture(), receipt = await f.service.submit(actor("b"), input("a"), "other-report");
    await f.service.review(actor("a"), receipt.reportId, { expectedRevision: 1, status: "reviewing" });
    expect(await f.service.eraseAccount(actor("a"), context())).toMatchObject({ status: "completed" });
    expect(await f.service.read(actor("b"), receipt.reportId)).toMatchObject({ reportId: receipt.reportId, status: "reviewing", revision: 2 });
    const [body] = await bodies(f.store); expect(body?.reporter).toBe("b");
    for (const key of ["target", "targetIssuer", "evidence", "reason"]) expect(body).not.toHaveProperty(key);
    expect(body?.audit).toHaveLength(1); expect(body?.audit[0]?.actor).toBe("b");
    expect(await f.service.queue()).toEqual([]);
    await expect(f.service.read(actor("moderator"), receipt.reportId, true)).rejects.toMatchObject({ status: 410 });
    await expect(f.service.submit(actor("b"), input("a"), "new-target-report")).rejects.toMatchObject({ status: 403 });
    expect(await f.service.submit(actor("b"), input("a"), "other-report")).toMatchObject({ reportId: receipt.reportId });
  });

  it.each(["reporter", "target", "audit"])("blocks unknown legacy %s provenance instead of adopting the current JWT", async kind => {
    const f = fixture(), receipt = await f.service.submit(actor(kind === "reporter" ? "a" : "b"), input(kind === "target" ? "a" : "peer"), "legacy-operation");
    if (kind === "audit") await f.service.review(actor("a"), receipt.reportId, { status: "reviewing", expectedRevision: 1 });
    await mutate(f.store, receipt.reportId, body => {
      if (kind === "reporter") delete body.reporterIssuer;
      if (kind === "target") delete body.targetIssuer;
      if (kind === "audit") delete body.audit[1]!.actorIssuer;
    });
    expect(await f.service.erasurePreflight(actor("a"), context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await f.service.eraseAccount(actor("a"), context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
    expect(await bodies(f.store)).toHaveLength(1);
    await expect(f.service.submit(actor("a"), input(), "later-operation")).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a late provider validation after erasure so no report can be resurrected", async () => {
    const f = fixture(); let release!: () => void;
    f.validateTarget.mockImplementationOnce(() => new Promise<{ peerIssuer: string }>(resolve => { release = () => resolve({ peerIssuer: "https://identity.test/cop" }); }));
    const sending = f.service.submit(actor("a"), input(), "in-flight-operation");
    while (!release) await new Promise(resolve => setTimeout(resolve, 0));
    expect(await f.service.eraseAccount(actor("a"), context())).toMatchObject({ status: "completed" });
    release(); await expect(sending).rejects.toMatchObject({ status: 403 });
    expect(await bodies(f.store)).toEqual([]);
  });

  it("handles readback failure as unavailable, rolls back partial local removal and retries safely", async () => {
    class FaultStore extends MemoryMobilityStore {
      fail = false;
      override transact<T>(keys: string[], run: (tx: MobilityTransaction) => Promise<T>): Promise<T> {
        let scans = 0;
        return super.transact(keys, tx => run({ ...tx, scan: async <V>(prefix: string) => {
          if (this.fail && prefix === "communication-safety:report:" && ++scans >= 2) throw new Error("SYNTHETIC_PRIVATE_STORE_ERROR");
          return tx.scan<V>(prefix);
        } }));
      }
    }
    const store = new FaultStore(), f = fixture(store), receipt = await f.service.submit(actor("a"), input(), "operation");
    store.fail = true;
    await expect(f.service.eraseAccount(actor("a"), context())).rejects.toMatchObject({ status: 503, message: "MODERATION_ERASURE_UNAVAILABLE" });
    store.fail = false; expect(await f.service.read(actor("a"), receipt.reportId)).toEqual(receipt);
    expect(await f.service.eraseAccount(actor("a"), context())).toMatchObject({ status: "completed" });
  });

  it("does not record proof on cancellation, rejects a conflicting erasure and rejects non-OIDC identity", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.service.eraseAccount(actor("a"), { ...context(), signal: controller.signal })).rejects.toBeDefined();
    expect(await f.store.transact([], tx => tx.scan("communication-safety:erasure-fence:"))).toEqual([]);
    await f.service.eraseAccount(actor("a"), context());
    await expect(f.service.eraseAccount(actor("a"), { ...context(), operationId: "other-operation" })).rejects.toMatchObject({ status: 409 });
    await expect(f.service.eraseAccount({ ...actor("a"), issuer: undefined }, context())).rejects.toMatchObject({ status: 401 });
  });
});

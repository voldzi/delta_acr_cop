import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SharedMobilityService } from "./mobility-invitations.js";
import type { GroupState } from "./mobility-service.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import type * as Wire from "./mobility-types.js";
import type { AuthenticatedActor } from "./security.js";
import { SharedVehicleErasureService } from "./shared-vehicle-erasure.js";

const issuer = "https://synthetic-races.example/issuer";
const now = new Date("2026-10-13T12:00:00.000Z");
const actor = (subjectId: string): AuthenticatedActor => ({
  authMode: "oidc", issuer, subjectId, displayName: `Synthetic ${subjectId}`,
  username: subjectId, email: `${subjectId}@example.test`, emailVerified: true, roles: []
});
function publicKey(): string {
  return (generateKeyPairSync("x25519").publicKey.export({ format: "der", type: "spki" }) as Buffer)
    .subarray(-32).toString("base64");
}
/** Direct inspection is limited to the test's process-local ciphertext cache. */
const points = (service: SharedMobilityService): Map<string, Wire.DispatchPointPublish> =>
  (service as unknown as { latestPoints: Map<string, Wire.DispatchPointPublish> }).latestPoints;

async function fixture() {
  const store = new MemoryMobilityStore(), service = new SharedMobilityService(store, () => now);
  const aActor = actor("a"), bActor = actor("b"), cActor = actor("c");
  const a = await service.account(aActor), b = await service.account(bActor), c = await service.account(cActor);
  const group = await service.createGroup(c, { operationId: randomUUID(), name: "Synthetic Dispatch race" });
  for (const account of [a, b]) {
    const current = await service.getGroup(c, group.groupId);
    const invitation = await service.createInvitation(c, "group", group.groupId, {
      operationId: randomUUID(), expectedMembershipRevision: current.membershipRevision, email: account.email!
    });
    await service.acceptInvitation(account, "group", { operationId: randomUUID(), invitationId: invitation.invitationId });
  }
  const devices = new Map<string, Wire.DispatchDevice>();
  for (const account of [a, b, c]) devices.set(account.accountId, await service.registerDevice(account, {
    operationId: randomUUID(), publicKeyX25519: publicKey(), deviceName: `Synthetic ${account.displayName}`
  }));
  const ready = await service.readiness(a, group.groupId);
  async function publication(account: Wire.MobilityAccount) {
    const device = devices.get(account.accountId)!;
    const started = await service.startShare(account, group.groupId, {
      operationId: randomUUID(), deviceId: device.deviceId, expectedMembershipRevision: ready.membershipRevision,
      audienceHash: ready.audienceHash, durationSeconds: 900, endPolicy: "duration", consent: true
    });
    const point: Wire.DispatchPointPublish = {
      deviceId: device.deviceId, sequence: 1, observedAt: now.toISOString(), source: "gps",
      membershipRevision: ready.membershipRevision, audienceHash: ready.audienceHash,
      boxes: ready.devices.map(recipient => ({ recipientDeviceId: recipient.deviceId,
        ephemeralPublicKeyX25519: publicKey(), combinedCiphertext: Buffer.alloc(64, 7).toString("base64") }))
    };
    return { shareId: started.share.shareId, point };
  }
  return { store, service, aActor, bActor, a, b, c, groupId: group.groupId, publication,
    erasure: new SharedVehicleErasureService(store, issuer) };
}

describe("permanent mobility fences and delayed Dispatch publication", () => {
  it.each(["sender", "recipient"] as const)("rejects a publication held after its SQL commit when the %s is fenced", async target => {
    const f = await fixture(), publication = await f.publication(f.a);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const seen = new Promise<void>(resolve => { entered = resolve; });
    const original = f.store.transact.bind(f.store);
    let paused = false;
    f.store.transact = async (keys, run) => {
      const result = await original(keys, run);
      const receipt = result as Wire.DispatchShareReceipt | undefined;
      if (!paused && keys.includes(`group:${f.groupId}`) && receipt?.share?.shareId === publication.shareId && receipt.share.sequence === 1) {
        paused = true; entered(); await held;
      }
      return result;
    };
    const pending = f.service.publishPoint(f.a, publication.shareId, publication.point);
    const rejected = expect(pending).rejects.toMatchObject(target === "sender"
      ? { status: 403, code: "ACCOUNT_ERASURE_FENCED" } : { status: 410, code: "SHARE_STOPPED" });
    try {
      await seen;
      const committed = await original([], tx => tx.get<GroupState>(`group:${f.groupId}`));
      expect(committed?.shares[publication.shareId]?.sequence).toBe(1);
      expect(points(f.service).size).toBe(0);
      expect(await f.erasure.erase(target === "sender" ? f.aActor : f.bActor, {
        operationId: randomUUID(), requestedAt: now.toISOString(), signal: new AbortController().signal
      })).toMatchObject({ status: "completed", wholeAccountErased: false });
      release(); await rejected;
      expect(points(f.service).size).toBe(0);
    } finally {
      release(); f.store.transact = original; f.service.closeDispatch();
    }
  });

  it("rechecks RAM capacity for both waiters instead of admitting both against the same old size", async () => {
    const f = await fixture(), a = await f.publication(f.a), b = await f.publication(f.b);
    // The other points represent already accepted independent publications at the global bound.
    for (let index = 0; index < 511; index++) points(f.service).set(randomUUID(), structuredClone(a.point));
    try {
      const results = await Promise.allSettled([
        f.service.publishPoint(f.a, a.shareId, a.point),
        f.service.publishPoint(f.b, b.shareId, b.point)
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ status: 503, code: "DISPATCH_CAPACITY" });
      expect(points(f.service).size).toBe(512);
      expect(Number(points(f.service).has(a.shareId)) + Number(points(f.service).has(b.shareId))).toBe(1);
    } finally { f.service.closeDispatch(); }
  });
});

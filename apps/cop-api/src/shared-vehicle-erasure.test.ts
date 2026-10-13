import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_ERASURE_ADAPTER_IDS, AccountErasureService } from "./account-erasure.js";
import { mobilityAccountFenceKey, mobilityIdentityDigest, mobilityIdentityFenceKey } from "./mobility-erasure-guard.js";
import { SharedMobilityService } from "./mobility-invitations.js";
import { invitationNotificationTarget, MobilityInvitationOutbox, type InvitationNotificationJob } from "./mobility-invitation-outbox.js";
import type { MessagingProvider } from "./messaging-provider.js";
import type { MobilityOperationReceipt, PrincipalAccount, VehicleState } from "./mobility-service.js";
import { MemoryMobilityStore, type MobilityTransaction } from "./mobility-store.js";
import type * as Wire from "./mobility-types.js";
import type { AuthenticatedActor } from "./security.js";
import { SharedVehicleErasureService } from "./shared-vehicle-erasure.js";

const issuer = "https://synthetic-erasure.example/issuer";
const now = new Date("2026-10-13T12:00:00.000Z");
const actor = (subjectId: string, actorIssuer = issuer): AuthenticatedActor => ({
  authMode: "oidc", issuer: actorIssuer, subjectId, displayName: `Synthetic ${subjectId}`,
  username: subjectId, email: `${subjectId}@example.test`, emailVerified: true, roles: []
});
const context = () => ({ operationId: randomUUID(), requestedAt: now.toISOString(), signal: new AbortController().signal });
const identityKey = (principal: AuthenticatedActor) => `identity:${mobilityIdentityDigest(principal.issuer!, principal.subjectId)}`;
const capabilities: Wire.SharedVehicleMember["capabilities"] = ["readVehicle", "readCosts", "recordRide", "recordExpense", "recordService", "editVehicle", "manageReminders", "manageMembers"];

async function fixture() {
  const store = new MemoryMobilityStore();
  const service = new SharedMobilityService(store, () => now);
  const aActor = actor("a"), bActor = actor("b");
  const a = await service.account(aActor), b = await service.account(bActor);
  const create = { operationId: randomUUID(), details: { name: "Synthetic shared vehicle" },
    ownerBinding: { version: 1 as const, localVehicleId: randomUUID() } };
  const vehicle = await service.createVehicle(a, create);
  const invite = await service.createInvitation(a, "vehicle", vehicle.vehicleId, {
    operationId: randomUUID(), expectedMembershipRevision: vehicle.membershipRevision,
    email: b.email!, capabilities
  });
  const accept = { operationId: randomUUID(), invitationId: invite.invitationId };
  await service.acceptInvitation(b, "vehicle", accept);
  const erasure = new SharedVehicleErasureService(store, issuer);
  return { store, service, aActor, bActor, a, b, vehicleId: vehicle.vehicleId, create, accept, erasure };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function state(f: Fixture): Promise<VehicleState> {
  const value = await f.store.transact([], tx => tx.get<VehicleState>(`vehicle:${f.vehicleId}`));
  expect(value).toBeDefined();
  return value!;
}
async function transfer(f: Fixture) {
  const vehicle = await f.service.getVehicle(f.a, f.vehicleId);
  return f.service.membership(f.a, f.vehicleId, { operationId: randomUUID(),
    expectedMembershipRevision: vehicle.membershipRevision, accountId: f.b.accountId, action: "transfer_ownership" });
}
async function write(f: Fixture, account: Wire.MobilityAccount, recordId: string = randomUUID(), expectedRecordRevision = 0, amount = "101") {
  const vehicle = await f.service.getVehicle(account, f.vehicleId);
  const request: Wire.SharedVehicleRecordWrite = { operationId: randomUUID(), recordId,
    expectedRecordRevision, expectedDataRevision: vehicle.dataRevision,
    expectedMembershipRevision: vehicle.membershipRevision, occurredAt: now.toISOString(), timeZone: "Europe/Prague",
    data: { kind: "expense", category: "other", amount: { currency: "CZK", minorUnits: amount } } };
  await f.service.writeRecord(account, f.vehicleId, request);
  return request;
}
async function voidRecord(f: Fixture, account: Wire.MobilityAccount, recordId: string) {
  const vehicle = await f.service.getVehicle(account, f.vehicleId), current = await state(f);
  return f.service.deleteRecord(account, f.vehicleId, { operationId: randomUUID(),
    expectedDataRevision: vehicle.dataRevision, expectedMembershipRevision: vehicle.membershipRevision,
    recordId, expectedRecordRevision: current.records[recordId]!.revision, reason: "Synthetic correction" });
}
async function fences(f: Fixture) {
  return f.store.transact([], tx => tx.scan("mobility-erasure:"));
}

describe("approved shared vehicle contribution erasure", () => {
  it("blocks a live owner before writing any revocation fence", async () => {
    const f = await fixture(), before = await state(f);
    expect(await f.erasure.preflight(f.aActor, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await f.erasure.erase(f.aActor, context())).toEqual({ status: "pending", reason: "ownership_unresolved", wholeAccountErased: false });
    expect(await fences(f)).toEqual([]);
    expect(await state(f)).toEqual(before);
    expect((await f.service.account(f.aActor)).accountId).toBe(f.a.accountId);
  });

  it("transfers only to a verified existing member and clears the old owner's local binding", async () => {
    const f = await fixture(), before = await state(f);
    expect(before.ownerBinding).toMatchObject({ ownerAccountId: f.a.accountId, localVehicleId: f.create.ownerBinding.localVehicleId });
    await transfer(f);
    const after = await state(f);
    expect(after.vehicle.members.find(member => member.accountId === f.b.accountId)).toMatchObject({ role: "owner", capabilities });
    expect(after.vehicle.members.find(member => member.accountId === f.a.accountId)?.role).toBe("driver");
    expect(after.ownerBinding).toBeUndefined();
    expect(after.vehicle.ownerBinding).toBeUndefined();
    expect(await f.erasure.preflight(f.aActor, context().signal)).toMatchObject({ ready: true, version: expect.any(String) });
  });

  it.each(["missing_account", "conflicting_identity", "fenced_target"] as const)("rejects transfer to %s without changing ownership", async problem => {
    const f = await fixture(), before = await state(f);
    await f.store.transact([], async tx => {
      if (problem === "missing_account") await tx.remove(`account:${f.b.accountId}`);
      if (problem === "conflicting_identity") {
        const principal = await tx.get<PrincipalAccount>(identityKey(f.bActor));
        await tx.set(identityKey(f.bActor), { ...principal, accountId: f.a.accountId });
      }
      if (problem === "fenced_target") await tx.set(mobilityAccountFenceKey(f.b.accountId), { operationId: randomUUID() });
    });
    await expect(transfer(f)).rejects.toMatchObject({ code: problem === "fenced_target" ? "ACCOUNT_ERASURE_FENCED" : "OWNER_TRANSFER_TARGET_UNAVAILABLE" });
    expect(await state(f)).toEqual(before);
  });

  it("physically removes A records and tombstones from every event while preserving B records exactly", async () => {
    const f = await fixture();
    const ownLive = await write(f, f.a, randomUUID(), 0, "111"), ownVoid = await write(f, f.a, randomUUID(), 0, "222");
    await voidRecord(f, f.a, ownVoid.recordId);
    const otherLive = await write(f, f.b, randomUUID(), 0, "333"), otherVoid = await write(f, f.b, randomUUID(), 0, "444");
    await voidRecord(f, f.b, otherVoid.recordId);
    await transfer(f);
    const before = await state(f), otherRecords = [otherLive.recordId, otherVoid.recordId].map(id => structuredClone(before.records[id]));
    const otherEvents = before.events.filter(event => event.record && event.record.authorAccountId === f.b.accountId);
    const result = await f.erasure.erase(f.aActor, context()), after = await state(f);
    expect(result).toMatchObject({ status: "completed", vehicleContributionsErased: true, wholeAccountErased: false, proofId: expect.any(String) });
    for (const id of [ownLive.recordId, ownVoid.recordId]) {
      expect(after.records[id]).toBeUndefined();
      expect(after.events.some(event => event.recordId === id || event.record?.recordId === id)).toBe(false);
    }
    expect([otherLive.recordId, otherVoid.recordId].map(id => after.records[id])).toEqual(otherRecords);
    expect(after.events.filter(event => event.record && event.record.authorAccountId === f.b.accountId)).toEqual(otherEvents);
    expect(JSON.stringify(after)).not.toContain(f.a.accountId);
    expect(after.vehicle.members).toHaveLength(1);
    expect(after.vehicle.members[0]?.accountId).toBe(f.b.accountId);
    expect(after.vehicle.deleted).toBe(false);
  });

  it("expires B's old projections without allowing cached operation replay to restore A", async () => {
    const f = await fixture();
    const old = await f.store.transact([], tx => tx.get<MobilityOperationReceipt>(`operation:${f.b.accountId}:${f.accept.operationId}`));
    expect(JSON.stringify(old?.result)).toContain(f.a.accountId);
    const own = await write(f, f.a);
    await transfer(f);
    expect((await f.erasure.erase(f.aActor, context())).status).toBe("completed");
    const tombstone = await f.store.transact([], tx => tx.get<MobilityOperationReceipt>(`operation:${f.b.accountId}:${f.accept.operationId}`));
    expect(tombstone).toEqual({ hash: old!.hash, createdAt: old!.createdAt, expired: true });
    await expect(f.service.acceptInvitation(f.b, "vehicle", f.accept)).rejects.toMatchObject({ status: 410, code: "OPERATION_EXPIRED" });
    expect((await state(f)).records[own.recordId]).toBeUndefined();
    expect(JSON.stringify(await f.store.transact([], tx => tx.scan("operation:")))).not.toContain(f.a.accountId);
  });

  it("blocks A's latest edit of B's record without deleting B or restoring an obsolete revision", async () => {
    const f = await fixture(), original = await write(f, f.b);
    await write(f, f.a, original.recordId, 1, "999");
    await transfer(f);
    const before = await state(f);
    expect(before.records[original.recordId]).toMatchObject({ authorAccountId: f.b.accountId, revision: 2 });
    expect(await f.erasure.preflight(f.aActor, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await f.erasure.erase(f.aActor, context())).toMatchObject({ status: "pending", reason: "ownership_unresolved" });
    expect(await fences(f)).toEqual([]);
    expect(await state(f)).toEqual(before);
  });

  it.each(["record_correction", "historical_audit"] as const)("blocks B's %s dependency on A's record without changing B", async dependency => {
    const f = await fixture();
    const ownedRecord = await write(f, f.a), otherRecord = await write(f, f.b);
    await f.store.transact([], async tx => {
      const current = await tx.get<VehicleState>(`vehicle:${f.vehicleId}`);
      const record = current!.records[otherRecord.recordId]!;
      const event = current!.events.find(item => item.recordId === record.recordId && item.record)!;
      // Supported stored historical shapes can have dependencies not visible in the latest author alone.
      if (dependency === "record_correction") {
        record.data = { kind: "odometer", odometerKm: "123", correctionOfRecordId: ownedRecord.recordId,
          correctionReason: "Synthetic original observation" };
        event.record = structuredClone(record);
      } else {
        event.audit = { version: 1, action: "correct", operationId: randomUUID(),
          previousRecordId: ownedRecord.recordId, previousRecordRevision: 1, reason: "Synthetic historical reference" };
      }
      await tx.set(`vehicle:${f.vehicleId}`, current);
    });
    await transfer(f);
    const before = await state(f), preservedRecord = structuredClone(before.records[otherRecord.recordId]);
    const preservedEvents = before.events.filter(event => event.recordId === otherRecord.recordId);
    expect(await f.erasure.preflight(f.aActor, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await f.erasure.erase(f.aActor, context())).toEqual({ status: "pending", reason: "ownership_unresolved", wholeAccountErased: false });
    const after = await state(f);
    expect(after).toEqual(before);
    expect(after.records[otherRecord.recordId]).toEqual(preservedRecord);
    expect(after.events.filter(event => event.recordId === otherRecord.recordId)).toEqual(preservedEvents);
    expect(await fences(f)).toEqual([]);
  });

  it("preserves an unrelated vehicle's state, history and cached projection byte for byte", async () => {
    const f = await fixture(), own = await write(f, f.a);
    const create = { operationId: randomUUID(), details: { name: "Independent B vehicle" },
      ownerBinding: { version: 1 as const, localVehicleId: randomUUID() } };
    const unrelated = await f.service.createVehicle(f.b, create);
    const request: Wire.SharedVehicleRecordWrite = { operationId: randomUUID(), recordId: randomUUID(),
      expectedRecordRevision: 0, expectedDataRevision: unrelated.dataRevision,
      expectedMembershipRevision: unrelated.membershipRevision, occurredAt: now.toISOString(), timeZone: "UTC",
      data: { kind: "reminder", title: "Independent B care reminder", dueOdometerKm: "500", completed: false } };
    await f.service.writeRecord(f.b, unrelated.vehicleId, request);
    const receiptKey = `operation:${f.b.accountId}:${create.operationId}`;
    const capture = async () => JSON.stringify(await f.store.transact([], async tx => ({
      state: await tx.get<VehicleState>(`vehicle:${unrelated.vehicleId}`),
      receipt: await tx.get<MobilityOperationReceipt>(receiptKey)
    })));
    const before = await capture(), beforeView = JSON.stringify(await f.service.getVehicle(f.b, unrelated.vehicleId));
    await transfer(f);
    expect((await f.erasure.erase(f.aActor, context())).status).toBe("completed");
    expect((await state(f)).records[own.recordId]).toBeUndefined();
    expect(await capture()).toBe(before);
    expect(JSON.stringify(await f.service.getVehicle(f.b, unrelated.vehicleId))).toBe(beforeView);
    expect(await f.service.createVehicle(f.b, create)).toEqual(unrelated);
  });

  it("invalidates B's pre-erasure cursor even if A already left the vehicle", async () => {
    const f = await fixture(), own = await write(f, f.a);
    await transfer(f);
    const vehicle = await f.service.getVehicle(f.a, f.vehicleId);
    await f.service.membership(f.a, f.vehicleId, { operationId: randomUUID(), action: "leave",
      accountId: f.a.accountId, expectedMembershipRevision: vehicle.membershipRevision });
    const before = await state(f);
    expect(before.vehicle.members.some(member => member.accountId === f.a.accountId)).toBe(false);
    const cursor = (await f.service.syncVehicle(f.b, f.vehicleId, undefined)).nextCursor;
    expect((await f.service.syncVehicle(f.b, f.vehicleId, cursor)).items).toEqual([]);
    expect((await f.erasure.erase(f.aActor, context())).status).toBe("completed");
    const after = await state(f);
    expect(after.vehicle.membershipRevision).toBeGreaterThan(before.vehicle.membershipRevision);
    expect(after.records[own.recordId]).toBeUndefined();
    await expect(f.service.syncVehicle(f.b, f.vehicleId, cursor)).rejects.toMatchObject({ status: 409, code: "CURSOR_SCOPE_CHANGED" });
    expect(JSON.stringify(await f.service.syncVehicle(f.b, f.vehicleId, undefined))).not.toContain(f.a.accountId);
  });

  it.each(["missing_identity", "missing_account", "conflicting_mapping"] as const)("fails closed for %s without accepting today's actor as provenance", async problem => {
    const f = await fixture(); await transfer(f);
    await f.store.transact([], async tx => {
      if (problem === "missing_identity") await tx.remove(identityKey(f.aActor));
      if (problem === "missing_account") await tx.remove(`account:${f.a.accountId}`);
      if (problem === "conflicting_mapping") {
        const principal = await tx.get<PrincipalAccount>(identityKey(f.aActor));
        await tx.set(identityKey(f.aActor), { ...principal, accountId: f.b.accountId });
      }
    });
    expect(await f.erasure.preflight(f.aActor, context().signal)).toEqual({ ready: false, reason: "ownership_unresolved" });
    expect(await f.erasure.erase(f.aActor, context())).toMatchObject({ status: "pending", reason: "ownership_unresolved", wholeAccountErased: false });
    expect(await fences(f)).toEqual([]);
  });

  it("isolates an identical subject under another issuer including its records and operation receipts", async () => {
    const f = await fixture(), otherActor = actor("a", "https://another-synthetic.example/issuer");
    const other = await f.service.account(otherActor);
    const create = { operationId: randomUUID(), details: { name: "Other issuer vehicle" } };
    const vehicle = await f.service.createVehicle(other, create);
    const before = await f.store.transact([], tx => tx.get<VehicleState>(`vehicle:${vehicle.vehicleId}`));
    await transfer(f); expect((await f.erasure.erase(f.aActor, context())).status).toBe("completed");
    expect(await f.service.createVehicle(other, create)).toEqual(vehicle);
    expect(await f.store.transact([], tx => tx.get(`vehicle:${vehicle.vehicleId}`))).toEqual(before);
    expect((await f.service.account(otherActor)).accountId).toBe(other.accountId);
    expect(await f.store.transact([], tx => tx.get(mobilityAccountFenceKey(other.accountId)))).toBeUndefined();
  });

  it("rejects old actor, retained account, old receipt and fresh writes after retry and process replacement", async () => {
    const f = await fixture(), own = await write(f, f.a); await transfer(f);
    const request = context(), first = await f.erasure.erase(f.aActor, request);
    expect(first.status).toBe("completed");
    const restarted = new SharedMobilityService(f.store, () => now);
    for (const service of [f.service, restarted]) {
      await expect(service.account(f.aActor)).rejects.toMatchObject({ status: 403, code: "ACCOUNT_ERASURE_FENCED" });
      await expect(service.createVehicle(f.a, f.create)).rejects.toMatchObject({ status: 403, code: "ACCOUNT_ERASURE_FENCED" });
      await expect(service.writeRecord(f.a, f.vehicleId, own)).rejects.toMatchObject({ status: 403, code: "ACCOUNT_ERASURE_FENCED" });
      await expect(service.createVehicle(f.a, { ...f.create, operationId: randomUUID() })).rejects.toMatchObject({ status: 403, code: "ACCOUNT_ERASURE_FENCED" });
    }
    expect(await new SharedVehicleErasureService(f.store, issuer).erase(f.aActor, request)).toEqual(first);
  });

  it("serializes an already admitted write before purge and rejects a write queued behind purge", async () => {
    const f = await fixture(); await transfer(f);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { entered = resolve; });
    const original = f.store.transact.bind(f.store);
    const recordId = randomUUID(), operationId = randomUUID(), vehicle = await f.service.getVehicle(f.a, f.vehicleId);
    const request: Wire.SharedVehicleRecordWrite = { operationId, recordId, expectedRecordRevision: 0,
      expectedDataRevision: vehicle.dataRevision, expectedMembershipRevision: vehicle.membershipRevision,
      occurredAt: now.toISOString(), timeZone: "UTC", data: { kind: "expense", category: "other", amount: { currency: "CZK", minorUnits: "123" } } };
    f.store.transact = (keys, run) => original(keys, async tx => {
      if (keys.includes(`operation:${f.a.accountId}:${operationId}`)) { entered(); await held; }
      return run(tx);
    });
    const admitted = f.service.writeRecord(f.a, f.vehicleId, request); await seen;
    const purge = f.erasure.erase(f.aActor, context());
    const late = f.service.writeRecord(f.a, f.vehicleId, { ...request, operationId: randomUUID(), recordId: randomUUID() });
    const lateCheck = expect(late).rejects.toMatchObject({ status: 403, code: "ACCOUNT_ERASURE_FENCED" });
    release(); await admitted; expect((await purge).status).toBe("completed"); await lateCheck;
    f.store.transact = original;
    expect((await state(f)).records[recordId]).toBeUndefined();
    expect(await f.store.transact([], tx => tx.get(`operation:${f.a.accountId}:${operationId}`))).toBeUndefined();
  });

  it("requires actual remove readback and rolls back when a custom store silently retains own receipts", async () => {
    const f = await fixture(); await write(f, f.a); await transfer(f);
    const before = await state(f), original = f.store.transact.bind(f.store);
    f.store.transact = (keys, run) => original(keys, tx => run({ ...tx,
      remove: async key => { if (!key.startsWith(`operation:${f.a.accountId}:`)) await tx.remove(key); }
    } satisfies MobilityTransaction));
    expect(await f.erasure.erase(f.aActor, context())).toEqual({ status: "pending", reason: "adapter_unavailable", wholeAccountErased: false });
    f.store.transact = original;
    expect(await state(f)).toEqual(before); expect(await fences(f)).toEqual([]);
  });

  it("never reports completion on storage outage", async () => {
    const f = await fixture(); await transfer(f);
    const original = f.store.transact.bind(f.store);
    f.store.transact = vi.fn(async () => { throw new Error("Synthetic store outage"); });
    expect(await f.erasure.erase(f.aActor, context())).toEqual({ status: "pending", reason: "adapter_unavailable", wholeAccountErased: false });
    await expect(f.erasure.preflight(f.aActor, context().signal)).rejects.toThrow("Synthetic store outage");
    f.store.transact = original; expect(await fences(f)).toEqual([]);
  });

  it("does not emit a new invitation notification to A after actual local erasure fences the recipient", async () => {
    const f = await fixture(); await transfer(f);
    const send = vi.fn().mockResolvedValue({ enabled: true, status: "online", notificationId: "synthetic-notification" });
    const worker = new MobilityInvitationOutbox(f.store, { sendNotification: send } as unknown as MessagingProvider, () => now);
    // Settle the fixture's already accepted invite; the tested invitation is still pending.
    await worker.drain(); expect(send).not.toHaveBeenCalled();
    const vehicle = await f.service.getVehicle(f.b, f.vehicleId);
    const invite = await f.service.createInvitation(f.b, "vehicle", f.vehicleId, { operationId: randomUUID(),
      expectedMembershipRevision: vehicle.membershipRevision, email: f.a.email!, capabilities: ["readVehicle"] });
    const jobKey = `invite-notification:${invite.invitationId}:${f.a.accountId}`;
    const eligible = await f.store.transact([], async tx => invitationNotificationTarget(tx,
      (await tx.get<InvitationNotificationJob>(jobKey))!, now));
    expect(eligible?.payload.audience).toEqual({ userIds: [f.aActor.subjectId] });
    expect(await f.erasure.erase(f.aActor, context())).toMatchObject({ status: "completed", wholeAccountErased: false });
    await worker.drain();
    expect(send).not.toHaveBeenCalled();
    expect(await f.store.transact([], tx => tx.get<InvitationNotificationJob>(jobKey))).toMatchObject({ state: "cancelled", attempts: 0 });
    await worker.close();
  });

  it("does not emit A's pending invitation to C after A transfers ownership and is locally fenced", async () => {
    const f = await fixture(), c = await f.service.account(actor("c")); await transfer(f);
    const send = vi.fn().mockResolvedValue({ enabled: true, status: "online", notificationId: "synthetic-notification" });
    const worker = new MobilityInvitationOutbox(f.store, { sendNotification: send } as unknown as MessagingProvider, () => now);
    await worker.drain(); expect(send).not.toHaveBeenCalled();
    const vehicle = await f.service.getVehicle(f.a, f.vehicleId);
    expect(vehicle.members.find(member => member.accountId === f.a.accountId)?.capabilities).toContain("manageMembers");
    const invite = await f.service.createInvitation(f.a, "vehicle", f.vehicleId, { operationId: randomUUID(),
      expectedMembershipRevision: vehicle.membershipRevision, email: c.email!, capabilities: ["readVehicle"] });
    const jobKey = `invite-notification:${invite.invitationId}:${c.accountId}`;
    const eligible = await f.store.transact([], async tx => invitationNotificationTarget(tx,
      (await tx.get<InvitationNotificationJob>(jobKey))!, now));
    expect(eligible?.payload.audience).toEqual({ userIds: ["c"] });
    expect(await f.erasure.erase(f.aActor, context())).toMatchObject({ status: "completed", wholeAccountErased: false });
    await worker.drain();
    expect(send).not.toHaveBeenCalled();
    expect(await f.store.transact([], tx => tx.get<InvitationNotificationJob>(jobKey))).toMatchObject({ state: "cancelled", attempts: 0 });
    await worker.close();
  });

  it("keeps full account erasure unavailable after this vehicle-only subset completes", async () => {
    const f = await fixture(); await transfer(f);
    expect(await f.erasure.erase(f.aActor, context())).toMatchObject({ status: "completed", wholeAccountErased: false });
    const allDomains = new AccountErasureService({ store: f.store, issuer, identitySecret: "synthetic-account-secret-".repeat(3),
      requiredAdapters: ACCOUNT_ERASURE_ADAPTER_IDS, adapters: [], accepted: true, allowUnboundSyntheticStore: true, now: () => now });
    expect(await allDomains.capabilities()).toMatchObject({ accountDeletion: false, unavailableReason: "required_adapters_missing" });
  });
});

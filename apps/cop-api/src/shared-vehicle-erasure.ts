import type { AccountErasureAssessment } from "./account-erasure.js";
import { acceptsMobilitySchema } from "./mobility-contract.js";
import { mobilityAccountFenceKey, mobilityIdentityDigest, mobilityIdentityFenceKey } from "./mobility-erasure-guard.js";
import { mobilityDigest, type GroupState, type MobilityOperationReceipt, type PrincipalAccount, type VehicleState } from "./mobility-service.js";
import type { MobilityStore, MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

type Checkpoint = { version: 1; operationId: string; requestedAt: string; vehicleContributionsErased: true };
export type SharedVehicleErasureResult =
  { status: "pending"; reason: "ownership_unresolved" | "adapter_unavailable"; wholeAccountErased: false } |
  { status: "completed"; vehicleContributionsErased: true; wholeAccountErased: false; proofId: string };
const CHECKPOINT = "mobility-erasure:vehicle-checkpoint:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Local vehicle contribution component, NOT a completed mobility_dispatch adapter.
 * Identity, Dispatch, provider handoffs and backup replay must have their own verified proofs.
 * No public route or production worker invokes this source candidate.
 */
export class SharedVehicleErasureService {
  constructor(readonly store: MobilityStore, readonly issuer: string) {
    if (!issuer) throw new Error("Shared vehicle erasure requires a verified issuer.");
  }
  private identity(actor: AuthenticatedActor): string {
    if (actor.authMode !== "oidc" || actor.issuer !== this.issuer || !actor.subjectId) throw new Error("Verified owner required");
    return mobilityIdentityDigest(this.issuer, actor.subjectId);
  }
  async preflight(actor: AuthenticatedActor, signal: AbortSignal): Promise<AccountErasureAssessment> {
    const identity = this.identity(actor);
    return this.store.transact([], async tx => {
      signal.throwIfAborted();
      const assessment = await this.assess(tx, actor, identity);
      signal.throwIfAborted();
      return assessment.ready ? { ready: true, version: assessment.version } : { ready: false, reason: "ownership_unresolved" };
    });
  }
  async erase(actor: AuthenticatedActor, context: { operationId: string; requestedAt: string; signal: AbortSignal }): Promise<SharedVehicleErasureResult> {
    const identity = this.identity(actor);
    if (!UUID.test(context.operationId) || !Number.isFinite(Date.parse(context.requestedAt))) throw new Error("Invalid erasure operation");
    const operationId = context.operationId.toLowerCase();
    try {
      return await this.store.transact([mobilityIdentityFenceKey(identity)], async tx => {
        context.signal.throwIfAborted();
        const saved = await tx.get<Checkpoint>(CHECKPOINT + identity);
        if (saved) {
          if (saved.version !== 1 || saved.operationId !== operationId || !saved.vehicleContributionsErased) throw new Error("Erasure checkpoint conflict");
          // The permanent fence is necessary even after a source rollback/retry.
          if (!await tx.get(mobilityIdentityFenceKey(identity))) throw new Error("Erasure fence missing");
        }
        const assessed = await this.assess(tx, actor, identity);
        if (!assessed.ready) return { status: "pending", reason: "ownership_unresolved", wholeAccountErased: false };
        const accountId = assessed.account?.accountId;
        const marker = { version: 1 as const, operationId, requestedAt: context.requestedAt };
        const existingFence = await tx.get<{ operationId: string }>(mobilityIdentityFenceKey(identity));
        if (existingFence && existingFence.operationId !== operationId) throw new Error("Erasure fence conflict");
        await tx.set(mobilityIdentityFenceKey(identity), marker);
        if (accountId) {
          const key = mobilityAccountFenceKey(accountId);
          const existing = await tx.get<{ operationId: string }>(key);
          if (existing && existing.operationId !== operationId) throw new Error("Erasure fence conflict");
          await tx.set(key, marker);
          await this.purgeVehicles(tx, accountId, context.signal);
        }
        context.signal.throwIfAborted();
        await tx.set(CHECKPOINT + identity, { ...marker, vehicleContributionsErased: true } satisfies Checkpoint);
        if (mobilityDigest(await tx.get(mobilityIdentityFenceKey(identity))) !== mobilityDigest(marker) ||
            (accountId && mobilityDigest(await tx.get(mobilityAccountFenceKey(accountId))) !== mobilityDigest(marker)) ||
            (await tx.get<Checkpoint>(CHECKPOINT + identity))?.operationId !== operationId) throw new Error("Erasure fence/checkpoint readback incomplete");
        // This proof covers this subset only. Account/Dispatch/provider rows still exist.
        return { status: "completed", vehicleContributionsErased: true, wholeAccountErased: false,
          proofId: mobilityDigest({ scope: "cop-shared-vehicle-erasure-v1", identity, operationId }) };
      });
    } catch {
      return { status: "pending", reason: "adapter_unavailable", wholeAccountErased: false };
    }
  }
  private async assess(tx: MobilityTransaction, actor: AuthenticatedActor, identity: string): Promise<
    { ready: true; version: string; account?: PrincipalAccount } | { ready: false }> {
    const mapped = await tx.get<PrincipalAccount>(`identity:${identity}`);
    const accounts = await tx.scan<PrincipalAccount>("account:");
    // Unsupported/ambiguous historical provenance cannot be adopted from today's login.
    if (accounts.some(entry => !validPrincipal(entry.value) || entry.key !== `account:${entry.value.accountId}`)) return { ready: false };
    const matches = accounts.filter(entry => entry.value.issuer === actor.issuer && entry.value.subject === actor.subjectId);
    if (!mapped) return matches.length ? { ready: false } : { ready: true, version: mobilityDigest({ identity, account: null }) };
    if (!validPrincipal(mapped) || mapped.issuer !== actor.issuer || mapped.subject !== actor.subjectId || matches.length !== 1 ||
        mobilityDigest(matches[0]!.value) !== mobilityDigest(mapped)) return { ready: false };
    const id = mapped.accountId;
    const vehicles = await tx.scan<VehicleState>("vehicle:");
    const ownedRecords = new Set(vehicles.flatMap(({ value: state }) => [
      ...Object.values(state?.records ?? {}).filter(record => record.authorAccountId === id).map(record => record.recordId),
      ...(state?.events ?? []).filter(event => event.record?.authorAccountId === id).map(event => event.record!.recordId)
    ]));
    for (const { key, value: state } of vehicles) {
      if (!validVehicleState(state) || key !== `vehicle:${state.vehicle.vehicleId}`) return { ready: false };
      if (!state.vehicle.deleted && state.vehicle.members.some(member => member.accountId === id && member.role === "owner")) return { ready: false };
      for (const record of Object.values(state.records)) {
        if (record.authorAccountId === id) continue;
        // A correction is B's record, but its personal source link cannot be silently discarded.
        if (hasErasedLink(record, id, new Set(), ownedRecords)) return { ready: false };
        const edits = state.events.filter(event => event.recordId === record.recordId && event.record);
        const last = edits.at(-1);
        // An owner can edit another author's record. Do not erase B or restore obsolete B history.
        if (!last || mobilityDigest(last.record) !== mobilityDigest(record) || last.authorAccountId === id) return { ready: false };
      }
      if (state.events.some(event => event.authorAccountId !== id && event.record?.authorAccountId !== id &&
        !ownedRecords.has(event.recordId ?? "") && hasErasedLink({ record: event.record, audit: event.audit }, id, new Set(), ownedRecords))) return { ready: false };
    }
    const groups = await tx.scan<GroupState>("group:");
    if (groups.some(({ value }) => !value?.group?.members || (!value.deletedAt &&
      value.group.members.some(member => member.accountId === id && member.role === "owner")))) return { ready: false };
    // Snapshot version detects transfer/revision/record changes between preflight and confirmation.
    return { ready: true, account: mapped, version: mobilityDigest({ identity, account: mapped,
      vehicles: vehicles.map(entry => ({ key: entry.key, value: entry.value })), groups }) };
  }
  private async purgeVehicles(tx: MobilityTransaction, accountId: string, signal: AbortSignal): Promise<void> {
    const affected = new Set<string>(), erasedRecords = new Set<string>();
    for (const { value: state } of await tx.scan<VehicleState>("vehicle:")) {
      for (const record of Object.values(state.records)) if (record.authorAccountId === accountId) erasedRecords.add(record.recordId);
      for (const event of state.events) if (event.record?.authorAccountId === accountId) erasedRecords.add(event.record.recordId);
    }
    for (const entry of await tx.scan<VehicleState>("vehicle:")) {
      signal.throwIfAborted();
      const state = entry.value;
      if (!hasErasedLink(state, accountId, new Set(), erasedRecords)) continue;
      const before = mobilityDigest(state);
      for (const [id, record] of Object.entries(state.records)) if (record.authorAccountId === accountId) delete state.records[id];
      const members = state.vehicle.members.filter(member => member.accountId !== accountId);
      state.vehicle.members = members;
      if (state.ownerBinding?.ownerAccountId === accountId) delete state.ownerBinding;
      scrubVehicleSnapshot(state.vehicle, accountId);
      state.events = state.events.filter(event => event.authorAccountId !== accountId &&
        event.record?.authorAccountId !== accountId && !(event.recordId && erasedRecords.has(event.recordId)))
        .map(event => { if (event.vehicle) scrubVehicleSnapshot(event.vehicle, accountId); return event; });
      if (mobilityDigest(state) !== before) {
        state.vehicle.dataRevision++;
        // Invalidate every old cursor, even if the account had already left this vehicle.
        state.vehicle.membershipRevision++;
        affected.add(state.vehicle.vehicleId);
        await tx.set(entry.key, state);
      }
    }
    // Cross-account receipts include stale membership and derived mileage. Preserve replay tombstones.
    for (const entry of await tx.scan<MobilityOperationReceipt>("operation:")) {
      signal.throwIfAborted();
      if (entry.key.startsWith(`operation:${accountId}:`)) { await tx.remove(entry.key); continue; }
      if (hasErasedLink(entry.value.result, accountId, affected, erasedRecords)) {
        await tx.set(entry.key, { hash: entry.value.hash, createdAt: entry.value.createdAt, expired: true } satisfies MobilityOperationReceipt);
      }
    }
    // Actual transaction readback; omission or a custom no-op store never yields a subset proof.
    for (const { value: state } of await tx.scan<VehicleState>("vehicle:")) {
      if (state.vehicle.members.some(member => member.accountId === accountId) || state.ownerBinding?.ownerAccountId === accountId ||
          Object.values(state.records).some(record => record.authorAccountId === accountId) ||
          state.events.some(event => event.authorAccountId === accountId || event.record?.authorAccountId === accountId ||
            hasErasedLink({ record: event.record, audit: event.audit, vehicle: event.vehicle }, accountId, new Set(), erasedRecords)) ||
          Object.values(state.records).some(record => hasErasedLink(record, accountId, new Set(), erasedRecords))) throw new Error("Vehicle erasure readback incomplete");
    }
    for (const entry of await tx.scan<MobilityOperationReceipt>("operation:")) if (entry.key.startsWith(`operation:${accountId}:`) ||
      hasErasedLink(entry.value.result, accountId, affected, erasedRecords)) throw new Error("Receipt erasure readback incomplete");
  }
}
function validPrincipal(value: PrincipalAccount | undefined): value is PrincipalAccount {
  if (!value || typeof value.issuer !== "string" || !value.issuer || typeof value.subject !== "string" || !value.subject ||
      typeof value.accountId !== "string" || !UUID.test(value.accountId)) return false;
  const { issuer: _issuer, subject: _subject, ...wire } = value;
  return acceptsMobilitySchema("MobilityAccount", wire);
}
function validVehicleState(state: VehicleState): boolean {
  return !!state && acceptsMobilitySchema("SharedVehicle", state.vehicle) && Number.isSafeInteger(state.sequence) &&
    (!state.ownerBinding || acceptsMobilitySchema("SharedVehicleOwnerBinding", state.ownerBinding)) &&
    state.sequence >= 0 && state.records && typeof state.records === "object" && !Array.isArray(state.records) &&
    Object.entries(state.records).every(([id, record]) => record.recordId === id && record.vehicleId === state.vehicle.vehicleId && acceptsMobilitySchema("SharedVehicleRecord", record)) &&
    Array.isArray(state.events) && state.events.every((event, index) => acceptsMobilitySchema("SharedVehicleSyncItem", event) &&
      (!event.vehicle || event.vehicle.vehicleId === state.vehicle.vehicleId) &&
      (!event.record || (event.recordId === event.record.recordId && event.record.vehicleId === state.vehicle.vehicleId)) &&
      event.sequence <= state.sequence && (index === 0 || event.sequence > state.events[index - 1]!.sequence));
}
function scrubVehicleSnapshot(vehicle: VehicleState["vehicle"], accountId: string): void {
  vehicle.members = vehicle.members.filter(member => member.accountId !== accountId);
  if (vehicle.ownerBinding?.ownerAccountId === accountId) delete vehicle.ownerBinding;
  // Historical derived values are not recomputed using today's remaining records.
  delete vehicle.odometerSnapshot;
  delete vehicle.odometerSnapshotV2;
  delete vehicle.activeCareReminders;
}
function hasErasedLink(value: unknown, accountId: string, vehicles: Set<string>, records: Set<string>, depth = 0): boolean {
  if (depth > 30) throw new Error("Unsupported receipt depth");
  if (Array.isArray(value)) return value.some(child => hasErasedLink(child, accountId, vehicles, records, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    (["accountId", "authorAccountId", "ownerAccountId", "inviterAccountId", "acceptedBy", "recipientAccountId"].includes(key) && child === accountId) ||
    (key === "vehicleId" && typeof child === "string" && vehicles.has(child)) ||
    (["recordId", "previousRecordId", "correctionOfRecordId"].includes(key) && typeof child === "string" && records.has(child)) ||
    hasErasedLink(child, accountId, vehicles, records, depth + 1));
}

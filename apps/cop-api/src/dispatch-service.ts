import { AsyncLocalStorage } from "node:async_hooks";
import { createPublicKey, diffieHellman, generateKeyPairSync, randomUUID } from "node:crypto";
import { MobilityService, MobilityFailure, mobilityDigest, requireMobility, type GroupState } from "./mobility-service.js";
import type { DispatchLeaseState } from "./dispatch-lease.js";
import type { MobilityTransaction } from "./mobility-store.js";
import type * as Wire from "./mobility-types.js";

export class DispatchService extends MobilityService {
  /** Only this map contains point ciphertext. Never serialized into the durable store. */
  private readonly invalidatedShares = new Map<string, number>();
  private readonly leaseContext = new AsyncLocalStorage<number>();
  private assertLease(generation: number): void {
    requireMobility(this.store.dispatchIsAvailable() && this.store.dispatchGeneration() === generation,
      503, "DISPATCH_UNAVAILABLE", "Šifrovaný kanál není dostupný.");
  }
  async withDispatchLease<T>(generation: number, work: () => Promise<T>): Promise<T> {
    return this.leaseContext.run(generation, async () => {
      this.assertLease(generation); const result = await work(); this.assertLease(generation); return result;
    });
  }
  override async operation<T>(account: Wire.MobilityAccount, operationId: string, scope: string,
    body: unknown, keys: string[], work: (tx: MobilityTransaction) => Promise<T>): Promise<T> {
    const generation = this.leaseContext.getStore();
    return super.operation(account, operationId, scope, body, keys, async tx => {
      if (generation !== undefined) this.assertLease(generation);
      const result = await work(tx);
      if (generation !== undefined) this.assertLease(generation);
      return result;
    });
  }
  private async dispatchTransact<T>(keys: string[], work: (tx: MobilityTransaction) => Promise<T>): Promise<T> {
    const generation = this.leaseContext.getStore() ?? this.store.dispatchGeneration();
    return this.store.transact(keys, async tx => {
      this.assertLease(generation); const result = await work(tx); this.assertLease(generation); return result;
    });
  }
  private cleanupTimer?: NodeJS.Timeout;
  private readonly latestPoints = new Map<string, Wire.DispatchPointPublish>();
  async group(tx: MobilityTransaction, id: string, account: Wire.MobilityAccount, manage = false): Promise<GroupState> {
    const state = await tx.get<GroupState>(`group:${id}`);
    requireMobility(state && !state.deletedAt, 404, "NOT_FOUND", "Soukromá skupina není dostupná.");
    const member = state.group.members.find(m => m.accountId === account.accountId);
    requireMobility(member && (!manage || member.role === "owner" || member.role === "admin"), 404, "NOT_FOUND", "Soukromá skupina není dostupná."); return state;
  }
  async invalidateGroups(tx: MobilityTransaction, accountId: string): Promise<void> {
    for (const entry of await tx.scan<GroupState>("group:")) {
      if (!entry.value.group.members.some(m => m.accountId === accountId)) continue;
      this.invalidateShares(entry.value); await tx.set(entry.key, entry.value);
    }
  }
  invalidateShares(state: GroupState): void {
    for (const share of Object.values(state.shares)) { if (share.state === "active") { share.state = "stopped"; this.invalidatedShares.set(share.shareId, this.now().getTime() + 180000); } this.latestPoints.delete(share.shareId); }
    state.group.sequence++;
  }
  /** Explicit restart invalidation; never restore old consent or RAM points. */
  async initializeDispatch(changed?: (state: DispatchLeaseState, generation: number) => void): Promise<void> {
    this.cleanupTimer = setInterval(() => {
      const time = this.now().getTime();
      for (const [id, point] of this.latestPoints) if (time - Date.parse(point.observedAt) >= 180000) this.latestPoints.delete(id);
      for (const [id, expires] of this.invalidatedShares) if (expires <= time) this.invalidatedShares.delete(id);
    }, 5000);
    this.cleanupTimer.unref();
    await this.store.startDispatchRecovery({
      changed,
      lost: () => { this.latestPoints.clear(); this.invalidatedShares.clear(); },
      acquired: async () => {
        this.latestPoints.clear(); this.invalidatedShares.clear();
        await this.store.transact(["dispatch-directory"], async tx => {
          for (const entry of await tx.scan<GroupState>("group:")) { this.invalidateShares(entry.value); await tx.set(entry.key, entry.value); }
        });
      }
    });
  }
  closeDispatch(): void { if (this.cleanupTimer) clearInterval(this.cleanupTimer); this.latestPoints.clear(); this.invalidatedShares.clear(); }
  async createGroup(account: Wire.MobilityAccount, input: Wire.DispatchGroupCreate): Promise<Wire.DispatchGroup> {
    return this.operation(account, input.operationId, "group:create", input, ["dispatch-directory", `owner:${account.accountId}`], async tx => {
      const owned = (await tx.scan<GroupState>("group:")).filter(x => !x.value.deletedAt && x.value.group.members.some(m => m.accountId === account.accountId && m.role === "owner"));
      const memberships = (await tx.scan<GroupState>("group:")).filter(x => !x.value.deletedAt && x.value.group.members.some(m => m.accountId === account.accountId));
      requireMobility(memberships.length < 100, 429, "MEMBERSHIP_LIMIT", "Byl dosažen limit členství.");
      requireMobility(owned.length < 50, 429, "GROUP_LIMIT", "Byl dosažen limit soukromých skupin.");
      const group: Wire.DispatchGroup = { contractVersion: "cop-private-dispatch-v1", groupId: randomUUID(), name: input.name, membershipRevision: 1, sequence: 1,
        members: [{ accountId: account.accountId, displayName: account.displayName, role: "owner" }], createdAt: this.now().toISOString(), deleted: false };
      await tx.set(`group:${group.groupId}`, { group, shares: {} } satisfies GroupState); return group;
    });
  }
  async ownedShares(account: Wire.MobilityAccount): Promise<Wire.DispatchOwnedShares> {
    return this.dispatchTransact(["dispatch-directory"], async tx => {
      const items: Wire.DispatchShare[] = [];
      for (const entry of await tx.scan<GroupState>("group:")) {
        this.expire(entry.value); await tx.set(entry.key, entry.value);
        items.push(...Object.values(entry.value.shares).filter(share => share.accountId === account.accountId && share.state === "active").map(publicShare));
      }
      return {items,serverTimestamp:this.now().toISOString()};
    });
  }
  async listGroups(account: Wire.MobilityAccount): Promise<Wire.DispatchGroupList> {
    return this.dispatchTransact([], async tx => ({ contractVersion: "cop-private-dispatch-v1", items: (await tx.scan<GroupState>("group:")).filter(x => !x.value.deletedAt && x.value.group.members.some(m => m.accountId === account.accountId)).map(x => x.value.group).slice(0, 100), serverTimestamp: this.now().toISOString() }));
  }
  async getGroup(account: Wire.MobilityAccount, id: string): Promise<Wire.DispatchGroup> { return this.dispatchTransact([`group:${id}`], async tx => (await this.group(tx, id, account)).group); }
  async membershipGroup(account: Wire.MobilityAccount, id: string, input: Wire.DispatchMembershipChange): Promise<Wire.DispatchGroup> {
    return this.operation(account, input.operationId, `group:${id}:members`, input, ["dispatch-directory", `group:${id}`], async tx => {
      const state = await this.group(tx, id, account, input.action !== "leave");
      requireMobility(state.group.membershipRevision === input.expectedMembershipRevision, 409, "REVISION_CONFLICT", "Členství se změnilo.");
      const target = state.group.members.find(m => m.accountId === input.accountId);
      requireMobility(target && target.role !== "owner", 409, "OWNER_REQUIRED", "Vlastník nemůže opustit aktivní skupinu.");
      if (input.action === "set_role") { requireMobility(state.group.members.find(m => m.accountId === account.accountId)?.role === "owner" && input.role, 403, "OWNER_REQUIRED", "Roli může změnit pouze vlastník."); target.role = input.role; }
      else { requireMobility(input.action !== "leave" || input.accountId === account.accountId, 403, "SELF_REQUIRED", "Odchod se týká pouze vašeho účtu."); state.group.members = state.group.members.filter(m => m.accountId !== input.accountId); }
      state.group.membershipRevision++; this.invalidateShares(state); await tx.set(`group:${id}`, state); return state.group;
    });
  }
  async deleteGroup(account: Wire.MobilityAccount, id: string, input: Wire.DispatchGroupDelete): Promise<Wire.DispatchGroup> {
    return this.operation(account, input.operationId, `group:${id}:delete`, input, ["dispatch-directory", `group:${id}`], async tx => {
      const state = await this.group(tx, id, account, true);
      requireMobility(state.group.membershipRevision === input.expectedMembershipRevision, 409, "REVISION_CONFLICT", "Členství se změnilo.");
      requireMobility(state.group.members.find(m => m.accountId === account.accountId)?.role === "owner", 403, "OWNER_REQUIRED", "Skupinu může zrušit pouze vlastník.");
      state.deletedAt = this.now().toISOString(); state.group.deleted = true; state.group.membershipRevision++; this.invalidateShares(state); await tx.set(`group:${id}`, state); return state.group;
    });
  }
  async registerDevice(account: Wire.MobilityAccount, input: Wire.DispatchDeviceRegister): Promise<Wire.DispatchDevice> {
    return this.operation(account, input.operationId, "dispatch:device-register", input, ["dispatch-directory", `devices:${account.accountId}`], async tx => {
      try {
        const raw = Buffer.from(input.publicKeyX25519, "base64"); if (raw.length !== 32) throw new Error("Invalid key");
        const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), raw]), format: "der", type: "spki" });
        diffieHellman({ privateKey: generateKeyPairSync("x25519").privateKey, publicKey });
      } catch { throw new MobilityFailure(400, "INVALID_DEVICE_KEY", "Neplatný veřejný klíč zařízení."); }
      const devices = await tx.scan<Wire.DispatchDevice>(`device:${account.accountId}:`);
      const duplicate = devices.find(x => x.value.publicKeyX25519 === input.publicKeyX25519);
      if (duplicate) return duplicate.value;
      requireMobility(devices.length < 8, 429, "DEVICE_LIMIT", "Nejprve odvolejte staré zařízení.");
      requireMobility(devices.length < 8, 429, "DEVICE_LIMIT", "Nejprve odvolejte staré zařízení.");
      const device: Wire.DispatchDevice = { deviceId: randomUUID(), accountId: account.accountId, publicKeyX25519: input.publicKeyX25519, keyRevision: 1, createdAt: this.now().toISOString() };
      await tx.set(`device:${account.accountId}:${device.deviceId}`, device); await this.invalidateGroups(tx, account.accountId); return device;
    });
  }
  async revokeDevice(account: Wire.MobilityAccount, input: Wire.DispatchDeviceRevoke): Promise<Wire.DispatchDevice> {
    return this.operation(account, input.operationId, "dispatch:device-revoke", input, ["dispatch-directory", `devices:${account.accountId}`], async tx => {
      const key = `device:${account.accountId}:${input.deviceId}`; const device = await tx.get<Wire.DispatchDevice>(key);
      requireMobility(device, 404, "NOT_FOUND", "Zařízení není dostupné."); await tx.remove(key); await this.invalidateGroups(tx, account.accountId); return device;
    });
  }
  async readinessWithin(tx: MobilityTransaction, state: GroupState): Promise<Wire.DispatchReadiness> {
    const accounts = new Set(state.group.members.map(m => m.accountId));
    const devices = (await tx.scan<Wire.DispatchDevice>("device:")).map(x => x.value).filter(x => accounts.has(x.accountId)).sort((a, b) => a.deviceId.localeCompare(b.deviceId, "en"));
    const ready = state.group.members.every(m => devices.some(d => d.accountId === m.accountId));
    return { contractVersion: "cop-private-dispatch-v1", groupId: state.group.groupId, membershipRevision: state.group.membershipRevision,
      state: ready ? "ready" : "missing_device_keys", audienceHash: mobilityDigest({ groupId: state.group.groupId, membershipRevision: state.group.membershipRevision, devices }), devices, serverTimestamp: this.now().toISOString() };
  }
  async readiness(account: Wire.MobilityAccount, id: string): Promise<Wire.DispatchReadiness> { return this.dispatchTransact(["dispatch-directory", `group:${id}`], async tx => this.readinessWithin(tx, await this.group(tx, id, account))); }
  private expire(state: GroupState): void {
    for (const share of Object.values(state.shares)) if (share.state === "active" && Date.parse(share.expiresAt) <= this.now().getTime()) { share.state = "expired"; this.latestPoints.delete(share.shareId); state.group.sequence++; }
    for (const [id, point] of this.latestPoints) if (this.now().getTime() - Date.parse(point.observedAt) > 180000) this.latestPoints.delete(id);
  }
  private receipt(operationId: string, share: Wire.DispatchShare): Wire.DispatchShareReceipt { return { contractVersion: "cop-private-dispatch-v1", operationId, share: publicShare(share), confirmed: true, serverTimestamp: this.now().toISOString() }; }
  async startShare(account: Wire.MobilityAccount, id: string, input: Wire.DispatchShareStart): Promise<Wire.DispatchShareReceipt> {
    const initial = await this.operation(account, input.operationId, `group:${id}:share-start`, input, ["dispatch-directory", `group:${id}`], async tx => {
      requireMobility(!(await tx.get(`cancel-start:${account.accountId}:${input.operationId}`)), 410, "START_CANCELLED", "Předchozí souhlas byl zrušen; požadavek nebude zahájen.");
      const state = await this.group(tx, id, account); this.expire(state);
      const ready = await this.readinessWithin(tx, state);
      requireMobility(ready.state === "ready", 409, "CHANNEL_NOT_READY", "Chybí ověřené klíče příjemců.");
      requireMobility(ready.membershipRevision === input.expectedMembershipRevision && ready.audienceHash === input.audienceHash, 409, "AUDIENCE_CHANGED", "Příjemci se změnili; vyžádejte nový souhlas.");
      requireMobility(ready.devices.some(d => d.deviceId === input.deviceId && d.accountId === account.accountId), 403, "DEVICE_REQUIRED", "Zařízení nepatří účtu.");
      requireMobility(!Object.values(state.shares).some(s => s.state === "active" && s.accountId === account.accountId), 409, "SHARE_ALREADY_ACTIVE", "Nejprve potvrďte zastavení předchozího sdílení.");
      const start = this.now(); const share: Wire.DispatchShare = { shareId: randomUUID(), groupId: id, accountId: account.accountId, deviceId: input.deviceId,
        membershipRevision: ready.membershipRevision, audienceHash: ready.audienceHash, startedAt: start.toISOString(), expiresAt: new Date(start.getTime() + input.durationSeconds * 1000).toISOString(), endPolicy: input.endPolicy, state: "active", sequence: 0 };
      state.shares[share.shareId] = {...share, startOperationId:input.operationId}; state.group.sequence++; await tx.set(`group:${id}`, state); await tx.set(`share:${share.shareId}`, { groupId: id }); return this.receipt(input.operationId, share);
    });
    // A start retry after stop/restart must return current inactive state, not revive an old active receipt.
    return this.dispatchTransact(["dispatch-directory", `group:${id}`], async tx => { const state = await this.group(tx, id, account); this.expire(state); await tx.set(`group:${id}`, state); const share = state.shares[initial.share.shareId]; requireMobility(share, 410, "SHARE_EXPIRED", "Sdílení skončilo."); return this.receipt(input.operationId, share); });
  }
  async publishPoint(account: Wire.MobilityAccount, shareId: string, input: Wire.DispatchPointPublish): Promise<Wire.DispatchShareReceipt> {
    const generation = this.leaseContext.getStore() ?? this.store.dispatchGeneration();
    const binding = await this.dispatchTransact([], tx => tx.get<{ groupId: string }>(`share:${shareId}`)); requireMobility(binding, 404, "NOT_FOUND", "Sdílení není dostupné.");
    const receipt = await this.dispatchTransact(["dispatch-directory", `group:${binding.groupId}`], async tx => {
      const state = await this.group(tx, binding.groupId, account); this.expire(state); const share = state.shares[shareId];
      requireMobility(share && share.accountId === account.accountId && share.deviceId === input.deviceId, 404, "NOT_FOUND", "Sdílení není dostupné.");
      requireMobility(share.state === "active", 410, "SHARE_STOPPED", "Sdílení skončilo.");
      const ready = await this.readinessWithin(tx, state);
      requireMobility(ready.state === "ready" && input.membershipRevision === share.membershipRevision && ready.membershipRevision === share.membershipRevision && input.audienceHash === share.audienceHash && ready.audienceHash === share.audienceHash, 409, "AUDIENCE_CHANGED", "Příjemci nebo klíče se změnili.");
      const expected = ready.devices.map(d => d.deviceId).sort(); const actual = input.boxes.map(b => b.recipientDeviceId).sort();
      requireMobility(mobilityDigest(expected) === mobilityDigest(actual) && new Set(actual).size === actual.length, 400, "RECIPIENT_SCOPE_INVALID", "Neúplný nebo nepovolený rozsah příjemců.");
      const observed = Date.parse(input.observedAt); const now = this.now().getTime();
      requireMobility(observed >= Date.parse(share.startedAt) && observed <= now + 5000 && now - observed <= 15000, 422, "GPS_STALE", "GPS vzorek není aktuální.");
      const hash = mobilityDigest(input);
      if (share.sequence === input.sequence) { requireMobility(share.lastHash === hash, 409, "SEQUENCE_CONFLICT", "Pořadí vzorku již bylo použito."); return this.receipt(pointReceiptId(shareId, input.sequence), share); }
      requireMobility(input.sequence > share.sequence, 409, "SEQUENCE_CONFLICT", "GPS pořadí se nesmí vracet.");
      if (share.lastObservedAt) {
        requireMobility(observed > Date.parse(share.lastObservedAt), 409, "OBSERVATION_ORDER", "Pozorování se nesmí vracet.");
        if (observed - Date.parse(share.lastObservedAt) < 5000) throw new MobilityFailure(429, "GPS_RATE_LIMIT", "Vzorky posílejte nejvýše jednou za pět sekund.", 5);
      }
      share.sequence = input.sequence; share.lastObservedAt = input.observedAt; share.lastHash = hash; state.group.sequence++; await tx.set(`group:${binding.groupId}`, state); return this.receipt(pointReceiptId(shareId, input.sequence), share);
    });
    // Even a late RAM write cannot resurrect a revoked share: snapshot authorizes against durable state.
    this.assertLease(generation);
    requireMobility(!this.invalidatedShares.has(shareId), 410, "SHARE_STOPPED", "Sdílení skončilo.");
    const bytes = Buffer.byteLength(JSON.stringify(input));
    const retainedBytes = [...this.latestPoints.entries()].filter(([id]) => id !== shareId).reduce((total, [, value]) => total + Buffer.byteLength(JSON.stringify(value)), 0);
    requireMobility((this.latestPoints.has(shareId) || this.latestPoints.size < 512) && retainedBytes + bytes <= 32 * 1024 * 1024, 503, "DISPATCH_CAPACITY", "Sdílení je dočasně přetížené.");
    this.latestPoints.set(shareId, structuredClone(input)); return receipt;
  }
  async cancelStart(account: Wire.MobilityAccount, input: Wire.DispatchStartCancel): Promise<Wire.DispatchStartCancelReceipt> {
    return this.operation(account, input.operationId, "dispatch:cancel-start", input, ["dispatch-directory"], async tx => {
      await tx.set(`cancel-start:${account.accountId}:${input.startOperationId}`, {cancelled:true});
      for (const entry of await tx.scan<GroupState>("group:")) {
        let changed=false;
        for (const share of Object.values(entry.value.shares)) {
          if (share.accountId !== account.accountId || share.startOperationId !== input.startOperationId) continue;
          share.state="stopped"; this.invalidatedShares.set(share.shareId,this.now().getTime()+180000); this.latestPoints.delete(share.shareId); changed=true;
        }
        if(changed) {entry.value.group.sequence++;await tx.set(entry.key,entry.value)}
      }
      return {operationId:input.operationId,startOperationId:input.startOperationId,confirmed:true,serverTimestamp:this.now().toISOString()};
    });
  }
  async stopShare(account: Wire.MobilityAccount, shareId: string, input: Wire.DispatchStop): Promise<Wire.DispatchShareReceipt> {
    const binding = await this.dispatchTransact([], tx => tx.get<{ groupId: string }>(`share:${shareId}`)); requireMobility(binding, 404, "NOT_FOUND", "Sdílení není dostupné.");
    const result = await this.operation(account, input.operationId, `share:${shareId}:stop`, input, ["dispatch-directory", `group:${binding.groupId}`], async tx => {
      // Own stop remains possible after removal/group deletion; it exposes no audience/coordinates.
      const state = await tx.get<GroupState>(`group:${binding.groupId}`); const share = state?.shares[shareId];
      requireMobility(state && share && share.accountId === account.accountId && share.deviceId === input.deviceId, 404, "NOT_FOUND", "Sdílení není dostupné.");
      share.state = "stopped"; this.invalidatedShares.set(shareId, this.now().getTime() + 180000); state.group.sequence++; this.latestPoints.delete(shareId); await tx.set(`group:${binding.groupId}`, state); return this.receipt(input.operationId, share);
    });
    this.latestPoints.delete(shareId); return result;
  }
  async snapshot(account: Wire.MobilityAccount, id: string, deviceId: string): Promise<Wire.DispatchSnapshot> {
    return this.dispatchTransact(["dispatch-directory", `group:${id}`], async tx => {
      const state = await this.group(tx, id, account); this.expire(state); const ready = await this.readinessWithin(tx, state);
      requireMobility(ready.devices.some(d => d.deviceId === deviceId && d.accountId === account.accountId), 403, "DEVICE_REQUIRED", "Zařízení nepatří účtu.");
      const shares = Object.values(state.shares).filter(s => s.state === "active" && s.audienceHash === ready.audienceHash && s.membershipRevision === ready.membershipRevision);
      const points: Wire.DispatchPoint[] = [];
      for (const share of shares) {
        const latest = this.latestPoints.get(share.shareId); if (!latest || latest.sequence !== share.sequence || this.now().getTime() - Date.parse(latest.observedAt) > 180000) continue;
        const box = latest.boxes.find(b => b.recipientDeviceId === deviceId); if (!box) continue;
        points.push({ shareId: share.shareId, accountId: share.accountId, deviceId: share.deviceId, sequence: latest.sequence, observedAt: latest.observedAt,
          expiresAt: new Date(Math.min(Date.parse(share.expiresAt), Date.parse(latest.observedAt) + 180000)).toISOString(), source: "gps", box });
      }
      await tx.set(`group:${id}`, state); return { contractVersion: "cop-private-dispatch-v1", group: state.group, readiness: ready, activeShares: shares.map(publicShare), points, serverTimestamp: this.now().toISOString() };
    });
  }
}
function publicShare(share: Wire.DispatchShare): Wire.DispatchShare {
  return { shareId: share.shareId, groupId: share.groupId, accountId: share.accountId, deviceId: share.deviceId, membershipRevision: share.membershipRevision,
    audienceHash: share.audienceHash, startedAt: share.startedAt, expiresAt: share.expiresAt, endPolicy: share.endPolicy, state: share.state, sequence: share.sequence };
}

function pointReceiptId(shareId: string, sequence: number): string {
 const hex = mobilityDigest({shareId, sequence}).slice(0,32).split(""); hex[12]="5"; hex[16]="8"; const value=hex.join(""); return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}

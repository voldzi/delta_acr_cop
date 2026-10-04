import { createHash, randomUUID } from "node:crypto";
import type { MobilityStore, MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";
import type * as Wire from "./mobility-types.js";

export class MobilityFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number
  ) {
    super(message);
  }
}
export type VehicleState = {
  vehicle: Wire.SharedVehicle;
  records: Record<string, Wire.SharedVehicleRecord>;
  events: Wire.SharedVehicleSyncItem[];
  sequence: number;
  deletedAt?: string;
};
export type GroupState = {
  group: Wire.DispatchGroup;
  shares: Record<string, Wire.DispatchShare & { lastObservedAt?: string; lastHash?: string; startOperationId?: string }>;
  deletedAt?: string;
};
type PrincipalAccount = Wire.MobilityAccount & { issuer: string; subject: string };
type Receipt = { hash: string; result?: unknown; createdAt: string; expired?: boolean };
export type Invite = {
  invitationId: string;
  entityType: "vehicle" | "group";
  entityId: string;
  inviterAccountId: string;
  email: string;
  capabilities: Wire.SharedVehicleMember["capabilities"];
  expiresAt: string;
  state: "pending" | "accepted" | "revoked";
  acceptedBy?: string;
};
const fullCapabilities: Wire.SharedVehicleMember["capabilities"] = [
  "readVehicle",
  "readCosts",
  "recordRide",
  "recordExpense",
  "recordService",
  "editVehicle",
  "manageReminders",
  "manageMembers"
];
export const mobilityDigest = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, v]) => [k, canonical(v)])
    );
  return value;
}
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export function requireMobility(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new MobilityFailure(status, code, message);
}
export class MobilityService {
  constructor(
    readonly store: MobilityStore,
    readonly now: () => Date = () => new Date()
  ) {}
  async pruneRetainedData(): Promise<void> {
    const cutoff = this.now().getTime() - 30 * 86400000;
    await this.store.transact(["dispatch-directory"], async tx => {
      for (const entry of await tx.scan<Receipt>("operation:")) {
        if (!entry.value.expired && Date.parse(entry.value.createdAt) <= cutoff) await tx.set(entry.key, {hash:entry.value.hash,createdAt:entry.value.createdAt,expired:true});
      }
      for (const entry of await tx.scan<Invite>("invite:")) if (Date.parse(entry.value.expiresAt) <= cutoff) await tx.remove(entry.key);
      for (const entry of await tx.scan<VehicleState>("vehicle:")) if (entry.value.deletedAt && Date.parse(entry.value.deletedAt) <= cutoff) await tx.remove(entry.key);
      for (const entry of await tx.scan<GroupState>("group:")) {
        const state = entry.value;
        if (state.deletedAt && Date.parse(state.deletedAt) <= cutoff) {
          for (const id of Object.keys(state.shares)) await tx.remove(`share:${id}`);
          await tx.remove(entry.key); continue;
        }
        for (const [id, share] of Object.entries(state.shares)) if (Date.parse(share.expiresAt) <= cutoff) { delete state.shares[id]; await tx.remove(`share:${id}`); }
        await tx.set(entry.key, state);
      }
    });
  }
  async account(actor: AuthenticatedActor): Promise<Wire.MobilityAccount> {
    requireMobility(
      actor.authMode === "oidc" && actor.issuer && actor.subjectId,
      401,
      "UNAUTHORIZED",
      "Je nutná ověřená identita COP."
    );
    const identity = mobilityDigest({ issuer: actor.issuer, subject: actor.subjectId });
    return this.store.transact([`identity:${identity}`], async (tx) => {
      const current = await tx.get<PrincipalAccount>(`identity:${identity}`);
      const value: PrincipalAccount = {
        contractVersion: "cop-mobility-account-v1",
        accountId: current?.accountId ?? randomUUID(),
        issuer: actor.issuer!,
        subject: actor.subjectId,
        displayName: actor.displayName,
        ...(actor.email ? { email: actor.email } : {}),
        emailVerified: !!actor.email && actor.emailVerified === true,
        serverTimestamp: this.now().toISOString()
      };
      await tx.set(`identity:${identity}`, value);
      await tx.set(`account:${value.accountId}`, value);
      const { issuer: _issuer, subject: _subject, ...publicValue } = value;
      return publicValue;
    });
  }
  async operation<T>(
    account: Wire.MobilityAccount,
    operationId: string,
    scope: string,
    body: unknown,
    keys: string[],
    work: (tx: MobilityTransaction) => Promise<T>
  ): Promise<T> {
    const receiptKey = `operation:${account.accountId}:${operationId.toLowerCase()}`;
    const hash = mobilityDigest({ scope, body });
    return this.store.transact([receiptKey, ...keys], async (tx) => {
      const receipt = await tx.get<Receipt>(receiptKey);
      if (receipt) {
        requireMobility(receipt.hash === hash, 409, "OPERATION_CONFLICT", "Operace již existuje s jinými údaji.");
        requireMobility(!receipt.expired, 410, "OPERATION_EXPIRED", "Potvrzení staré operace vypršelo; obnovte aktuální stav. Operace nebude znovu provedena.");
        return receipt.result as T;
      }
      const result = await work(tx);
      await tx.set(receiptKey, { hash, result, createdAt: this.now().toISOString() } satisfies Receipt);
      return result;
    });
  }
  async vehicle(
    tx: MobilityTransaction,
    vehicleId: string,
    account: Wire.MobilityAccount,
    capability: Wire.SharedVehicleMember["capabilities"][number] = "readVehicle",
    allowDeleted = false
  ): Promise<VehicleState> {
    const state = await tx.get<VehicleState>(`vehicle:${vehicleId}`);
    requireMobility(state && (allowDeleted || !state.vehicle.deleted), 404, "NOT_FOUND", "Vozidlo není dostupné.");
    const member = state.vehicle.members.find((m) => m.accountId === account.accountId);
    requireMobility(member?.capabilities.includes(capability), 404, "NOT_FOUND", "Vozidlo není dostupné.");
    return state;
  }
  revisions(state: VehicleState, body: { expectedDataRevision?: number; expectedMembershipRevision: number }): void {
    requireMobility(
      body.expectedMembershipRevision === state.vehicle.membershipRevision &&
        (body.expectedDataRevision === undefined || body.expectedDataRevision === state.vehicle.dataRevision),
      409,
      "REVISION_CONFLICT",
      "Sdílená evidence se změnila; obnovte stav."
    );
  }
  async vehicleEvent(
    tx: MobilityTransaction,
    state: VehicleState,
    actor: Wire.MobilityAccount,
    type: Wire.SharedVehicleSyncItem["type"],
    record?: Wire.SharedVehicleRecord
  ): Promise<void> {
    state.sequence++;
    state.vehicle.updatedAt = this.now().toISOString();
    const event: Wire.SharedVehicleSyncItem = {
      sequence: state.sequence,
      type,
      authorAccountId: actor.accountId,
      createdAt: this.now().toISOString(),
      ...(record
        ? { record: structuredClone(record), recordId: record.recordId }
        : { vehicle: structuredClone(state.vehicle) })
    };
    state.events.push(event);
    requireMobility(
      state.events.length <= 100000,
      429,
      "VEHICLE_HISTORY_LIMIT",
      "Evidence dosáhla limitu; kontaktujte správce."
    );
    await tx.set(`vehicle:${state.vehicle.vehicleId}`, state);
  }
  vehicleReceipt(state: VehicleState, operationId: string, recordId?: string): Wire.SharedVehicleReceipt {
    return {
      contractVersion: "cop-shared-vehicles-v1",
      operationId,
      vehicleId: state.vehicle.vehicleId,
      dataRevision: state.vehicle.dataRevision,
      membershipRevision: state.vehicle.membershipRevision,
      eventSequence: state.sequence,
      confirmed: true,
      ...(recordId ? { recordId } : {})
    };
  }
  async createVehicle(account: Wire.MobilityAccount, input: Wire.SharedVehicleCreate): Promise<Wire.SharedVehicle> {
    return this.operation(
      account,
      input.operationId,
      "vehicle:create",
      input,
      [`owner:${account.accountId}`],
      async (tx) => {
        const owned = (await tx.scan<VehicleState>("vehicle:")).filter(
          (x) =>
            !x.value.vehicle.deleted &&
            x.value.vehicle.members.some((m) => m.accountId === account.accountId && m.role === "owner")
        );
        const memberships = (await tx.scan<VehicleState>("vehicle:")).filter(x => !x.value.vehicle.deleted && x.value.vehicle.members.some(m => m.accountId === account.accountId));
        requireMobility(memberships.length < 100, 429, "MEMBERSHIP_LIMIT", "Byl dosažen limit členství.");
        requireMobility(owned.length < 50, 429, "VEHICLE_LIMIT", "Byl dosažen limit vozidel.");
        const timestamp = this.now().toISOString();
        const vehicle: Wire.SharedVehicle = {
          contractVersion: "cop-shared-vehicles-v1",
          vehicleId: randomUUID(),
          details: input.details,
          dataRevision: 1,
          membershipRevision: 1,
          members: [
            {
              accountId: account.accountId,
              displayName: account.displayName,
              role: "owner",
              capabilities: fullCapabilities,
              joinedAt: timestamp
            }
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
          deleted: false
        };
        const state: VehicleState = { vehicle, records: {}, events: [], sequence: 0 };
        await this.vehicleEvent(tx, state, account, "vehicle");
        return vehicle;
      }
    );
  }
  async listVehicles(account: Wire.MobilityAccount): Promise<Wire.SharedVehicleList> {
    return this.store.transact([], async (tx) => ({
      contractVersion: "cop-shared-vehicles-v1",
      items: (await tx.scan<VehicleState>("vehicle:"))
        .filter(
          (x) =>
            !x.value.vehicle.deleted &&
            x.value.vehicle.members.some(
              (m) => m.accountId === account.accountId && m.capabilities.includes("readVehicle")
            )
        )
        .map((x) => x.value.vehicle)
        .slice(0, 100),
      serverTimestamp: this.now().toISOString()
    }));
  }
  async getVehicle(account: Wire.MobilityAccount, id: string): Promise<Wire.SharedVehicle> {
    return this.store.transact([`vehicle:${id}`], async (tx) => (await this.vehicle(tx, id, account)).vehicle);
  }
  async updateVehicle(
    account: Wire.MobilityAccount,
    id: string,
    input: Wire.SharedVehicleUpdate
  ): Promise<Wire.SharedVehicleReceipt> {
    return this.operation(account, input.operationId, `vehicle:${id}:update`, input, [`vehicle:${id}`], async (tx) => {
      const state = await this.vehicle(tx, id, account, "editVehicle");
      this.revisions(state, input);
      state.vehicle.details = input.details;
      state.vehicle.dataRevision++;
      await this.vehicleEvent(tx, state, account, "vehicle");
      return this.vehicleReceipt(state, input.operationId);
    });
  }
  async membership(
    account: Wire.MobilityAccount,
    id: string,
    input: Wire.SharedVehicleMembershipChange
  ): Promise<Wire.SharedVehicleReceipt> {
    return this.operation(
      account,
      input.operationId,
      `vehicle:${id}:membership`,
      input,
      [`vehicle:${id}`],
      async (tx) => {
        const state = await this.vehicle(tx, id, account, input.action === "leave" ? "readVehicle" : "manageMembers");
        this.revisions(state, input);
        const self = state.vehicle.members.find((m) => m.accountId === account.accountId)!;
        const target = state.vehicle.members.find((m) => m.accountId === input.accountId);
        requireMobility(target, 404, "NOT_FOUND", "Člen není dostupný.");
        if (input.action === "transfer_ownership") {
          requireMobility(
            self.role === "owner" && target !== self,
            403,
            "OWNER_REQUIRED",
            "Převod může provést pouze vlastník."
          );
          self.role = "driver";
          target.role = "owner";
          target.capabilities = [...fullCapabilities];
        } else if (input.action === "set_capabilities") {
          const capabilities = input.capabilities ?? [];
          requireMobility(
            target.role !== "owner" && capabilities.includes("readVehicle"),
            422,
            "INVALID_CAPABILITIES",
            "Vlastník musí zůstat správcem; člen potřebuje přístup k vozidlu."
          );
          requireMobility(
            self.role === "owner" || capabilities.every((cap) => self.capabilities.includes(cap)),
            403,
            "CAPABILITY_ESCALATION",
            "Nelze udělit vyšší oprávnění."
          );
          target.capabilities = [...new Set(capabilities)];
        } else {
          requireMobility(
            target.role !== "owner" && (input.action !== "leave" || target.accountId === account.accountId),
            409,
            "OWNER_TRANSFER_REQUIRED",
            "Nejprve převeďte vlastnictví nebo vozidlo zrušte."
          );
          state.vehicle.members = state.vehicle.members.filter((m) => m !== target);
        }
        state.vehicle.membershipRevision++;
        await this.vehicleEvent(tx, state, account, "membership");
        return this.vehicleReceipt(state, input.operationId);
      }
    );
  }
  recordCapability(data: Wire.SharedVehicleRecordData): Wire.SharedVehicleMember["capabilities"][number] {
    if (data.kind === "ride_summary") return "recordRide";
    if (data.kind === "expense" || data.kind === "energy") return "recordExpense";
    if (data.kind === "reminder") return "manageReminders";
    if (data.kind === "service") return "recordService";
    return "editVehicle";
  }
  async writeRecord(
    account: Wire.MobilityAccount,
    id: string,
    input: Wire.SharedVehicleRecordWrite
  ): Promise<Wire.SharedVehicleReceipt> {
    return this.operation(account, input.operationId, `vehicle:${id}:record`, input, [`vehicle:${id}`], async (tx) => {
      const state = await this.vehicle(tx, id, account, this.recordCapability(input.data));
      this.revisions(state, input);
      const current = state.records[input.recordId];
      requireMobility(
        (current?.revision ?? 0) === input.expectedRecordRevision && !current?.deleted,
        409,
        "RECORD_CONFLICT",
        "Záznam byl změněn nebo odstraněn."
      );
      if (current)
        requireMobility(
          current.authorAccountId === account.accountId ||
            state.vehicle.members.find((m) => m.accountId === account.accountId)?.role === "owner",
          403,
          "AUTHOR_REQUIRED",
          "Cizí záznam může opravit pouze vlastník."
        );
      try {
        new Intl.DateTimeFormat("cs", { timeZone: input.timeZone }).format();
      } catch {
        throw new MobilityFailure(400, "INVALID_TIME_ZONE", "Neplatná časová zóna.");
      }
      if (input.data.kind === "odometer") {
        const observations = Object.values(state.records).filter(
          (r) => !r.deleted && r.data.kind === "odometer" && r.recordId !== input.recordId
        );
        const at = Date.parse(input.occurredAt);
        const value = decimalThousandths(input.data.odometerKm);
        const incompatible = observations.some(
          (r) =>
            r.data.kind === "odometer" &&
            (Date.parse(r.occurredAt) <= at
              ? decimalThousandths(r.data.odometerKm) > value
              : decimalThousandths(r.data.odometerKm) < value)
        );
        if (incompatible || current)
          requireMobility(
            input.data.correctionOfRecordId &&
              state.records[input.data.correctionOfRecordId]?.data.kind === "odometer" &&
              input.data.correctionReason?.trim(),
            422,
            "ODOMETER_CORRECTION_REQUIRED",
            "Oprava tachometru vyžaduje původní pozorování a důvod."
          );
      }
      const record: Wire.SharedVehicleRecord = {
        recordId: input.recordId,
        vehicleId: id,
        authorAccountId: current?.authorAccountId ?? account.accountId,
        createdAt: current?.createdAt ?? this.now().toISOString(),
        occurredAt: input.occurredAt,
        timeZone: input.timeZone,
        revision: (current?.revision ?? 0) + 1,
        data: input.data,
        deleted: false
      };
      state.records[record.recordId] = record;
      state.vehicle.dataRevision++;
      await this.vehicleEvent(tx, state, account, "record", record);
      return this.vehicleReceipt(state, input.operationId, record.recordId);
    });
  }
  async deleteRecord(
    account: Wire.MobilityAccount,
    id: string,
    input: Wire.SharedVehicleRecordDelete
  ): Promise<Wire.SharedVehicleReceipt> {
    return this.operation(
      account,
      input.operationId,
      `vehicle:${id}:delete-record`,
      input,
      [`vehicle:${id}`],
      async (tx) => {
        const state = await this.vehicle(tx, id, account, "editVehicle");
        this.revisions(state, input);
        const record = state.records[input.recordId];
        requireMobility(
          record && !record.deleted && record.revision === input.expectedRecordRevision,
          409,
          "RECORD_CONFLICT",
          "Záznam není aktuální."
        );
        requireMobility(
          record.authorAccountId === account.accountId ||
            state.vehicle.members.find((m) => m.accountId === account.accountId)?.role === "owner",
          403,
          "AUTHOR_REQUIRED",
          "Cizí záznam může odstranit pouze vlastník."
        );
        record.deleted = true;
        record.revision++;
        state.vehicle.dataRevision++;
        await this.vehicleEvent(tx, state, account, "deleted", record);
        return this.vehicleReceipt(state, input.operationId, record.recordId);
      }
    );
  }
  async deleteVehicle(
    account: Wire.MobilityAccount,
    id: string,
    input: Wire.SharedVehicleDelete
  ): Promise<Wire.SharedVehicleReceipt> {
    return this.operation(account, input.operationId, `vehicle:${id}:delete`, input, [`vehicle:${id}`], async (tx) => {
      const state = await this.vehicle(tx, id, account, "manageMembers");
      this.revisions(state, input);
      requireMobility(
        state.vehicle.members.find((m) => m.accountId === account.accountId)?.role === "owner",
        403,
        "OWNER_REQUIRED",
        "Vozidlo může zrušit pouze vlastník."
      );
      state.vehicle.deleted = true;
      state.vehicle.dataRevision++;
      state.vehicle.membershipRevision++;
      state.deletedAt = this.now().toISOString();
      await this.vehicleEvent(tx, state, account, "deleted");
      return this.vehicleReceipt(state, input.operationId);
    });
  }
  async syncVehicle(
    account: Wire.MobilityAccount,
    id: string,
    cursor: string | undefined,
    limit = 100
  ): Promise<Wire.SharedVehicleSync> {
    return this.store.transact([`vehicle:${id}`], async (tx) => {
      const state = await this.vehicle(tx, id, account);
      let after = 0;
      if (cursor) {
        let parsed: { a: string; v: string; m: number; s: number };
        try {
          const bytes = Buffer.from(cursor, "base64url");
          if (bytes.length !== 40 || bytes.toString("base64url") !== cursor) throw new Error("Invalid cursor");
          const uuid = (buffer: Buffer): string =>
            buffer.toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5");
          parsed = {
            a: uuid(bytes.subarray(0, 16)),
            v: uuid(bytes.subarray(16, 32)),
            m: bytes.readUInt32BE(32),
            s: bytes.readUInt32BE(36)
          };
        } catch {
          throw new MobilityFailure(400, "INVALID_CURSOR", "Neplatný kurzor.");
        }
        requireMobility(
          parsed.a === account.accountId &&
            parsed.v === id &&
            parsed.m === state.vehicle.membershipRevision &&
            Number.isSafeInteger(parsed.s) &&
            parsed.s >= 0 &&
            parsed.s <= state.sequence,
          409,
          "CURSOR_SCOPE_CHANGED",
          "Rozsah synchronizace se změnil."
        );
        after = parsed.s;
      }
      const readCosts = state.vehicle.members
        .find((m) => m.accountId === account.accountId)!
        .capabilities.includes("readCosts");
      const pending = state.events.filter((e) => e.sequence > after);
      const scanned = pending.slice(0, limit);
      const items = scanned.filter(
        (e) => readCosts || !e.record || !["expense", "energy", "service"].includes(e.record.data.kind)
      );
      const sequence = scanned.at(-1)?.sequence ?? after;
      return {
        contractVersion: "cop-shared-vehicles-v1",
        vehicleId: id,
        items,
        nextCursor: vehicleCursor(account.accountId, id, state.vehicle.membershipRevision, sequence),
        hasMore: pending.length > limit,
        dataRevision: state.vehicle.dataRevision,
        membershipRevision: state.vehicle.membershipRevision,
        serverTimestamp: this.now().toISOString()
      };
    });
  }
}

function vehicleCursor(accountId: string, vehicleId: string, membershipRevision: number, sequence: number): string {
  const bytes = Buffer.alloc(40);
  Buffer.from(accountId.replaceAll("-", ""), "hex").copy(bytes, 0);
  Buffer.from(vehicleId.replaceAll("-", ""), "hex").copy(bytes, 16);
  bytes.writeUInt32BE(membershipRevision, 32);
  bytes.writeUInt32BE(sequence, 36);
  return bytes.toString("base64url");
}

function decimalThousandths(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

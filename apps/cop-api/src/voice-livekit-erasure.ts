import { createHash } from "node:crypto";
import { RoomServiceClient } from "livekit-server-sdk";
import type { AccountErasureAdapter } from "./account-erasure.js";
import { liveKitRoomName } from "./voice-call-media.js";
import type { VoiceCallStore } from "./voice-call-store.js";

export interface VoiceErasureProvider {
  ready(signal: AbortSignal): Promise<boolean>;
  /** Remove only the exact actor in explicit COP call rooms and verify absence. */
  removeAndVerify(subjectId: string, rooms: readonly string[], signal: AbortSignal, context?: { issuer: string; operationId: string }): Promise<boolean>;
}
export interface LiveKitErasureClient {
  listRooms(names?: string[]): Promise<Array<{ name: string }>>;
  listParticipants(room: string): Promise<Array<{ identity: string }>>;
  removeParticipant(room: string, subjectId: string): Promise<unknown>;
}

/** Uses existing deployment-owned LiveKit credentials, never browser inputs. */
export class LiveKitVoiceErasureProvider implements VoiceErasureProvider {
  private readonly client: LiveKitErasureClient;
  constructor(options: { adminUrl: string; apiKey: string; apiSecret: string }) {
    const url = new URL(options.adminUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !options.apiKey || !options.apiSecret) throw new Error("Trusted HTTPS LiveKit admin URL and existing credentials required");
    this.client = new RoomServiceClient(url.toString().replace(/\/$/u, ""), options.apiKey, options.apiSecret, { requestTimeout: 5, failover: false });
  }
  async ready(signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    // A nonexistent named probe cannot accidentally enumerate or mutate all rooms.
    await this.client.listRooms(["cop-erasure-readiness-probe"]);
    signal.throwIfAborted();
    return true;
  }
  async removeAndVerify(subjectId: string, rooms: readonly string[], signal: AbortSignal): Promise<boolean> {
    return removeAndVerifyLiveKitParticipant(this.client, subjectId, rooms, signal);
  }
}

export async function removeAndVerifyLiveKitParticipant(client: LiveKitErasureClient, subjectId: string, rooms: readonly string[], signal: AbortSignal): Promise<boolean> {
    if (rooms.some(name => !/^cop-call-[a-f0-9-]{36}$/u.test(name))) throw new Error("Unproven COP room");
    signal.throwIfAborted();
    // Cover active rooms whose local memory record was lost on an old restart.
    // RoomService listRooms has no pagination; refuse an excessive inventory.
    const inventory = await client.listRooms();
    signal.throwIfAborted();
    if (inventory.length > 10_000) throw new Error("LiveKit inventory exceeds verified bound");
    if (inventory.some(room => room.name.startsWith("cop-call-") && !/^cop-call-[a-f0-9-]{36}$/u.test(room.name))) throw new Error("Unknown legacy COP room");
    const discovered = inventory.map(room => room.name).filter(name => /^cop-call-[a-f0-9-]{36}$/u.test(name));
    // The complete active inventory also proves old inactive rooms absent; do
    // not perform one remote lookup for every historical call ever retained.
    const names = [...new Set(discovered)].sort();
    for (const name of names) {
      signal.throwIfAborted();
      const active = await client.listRooms([name]);
      signal.throwIfAborted();
      if (!active.some(room => room.name === name)) continue;
      const participants = await client.listParticipants(name);
      signal.throwIfAborted();
      if (participants.some(participant => participant.identity === subjectId)) {
        await client.removeParticipant(name, subjectId);
        signal.throwIfAborted();
      }
      // A disappearing room is success only after a fresh explicit-room inventory.
      const currentRooms = await client.listRooms([name]);
      signal.throwIfAborted();
      if (currentRooms.some(room => room.name === name)) {
        const remaining = await client.listParticipants(name);
        signal.throwIfAborted();
        if (remaining.some(participant => participant.identity === subjectId)) return false;
      }
    }
    signal.throwIfAborted();
    const finalInventory = await client.listRooms();
    signal.throwIfAborted();
    if (finalInventory.length > 10_000 || finalInventory.some(room => room.name.startsWith("cop-call-") && (!/^cop-call-[a-f0-9-]{36}$/u.test(room.name) || !names.includes(room.name)))) return false;
    return true;
}

export function createVoiceLiveKitErasureAdapter(options: {
  issuer: string;
  stores: readonly VoiceCallStore[];
  provider: VoiceErasureProvider | undefined;
  /** True only when this installation has never issued media credentials. */
  mediaNeverEnabled?: boolean;
  now?: () => Date;
}): AccountErasureAdapter {
  if (!options.issuer || !options.stores.length || new Set(options.stores).size !== options.stores.length || (options.mediaNeverEnabled && options.provider)) throw new Error("Explicit voice owner stores/provider required");
  const verifiedOwner = (actor: Parameters<AccountErasureAdapter["erase"]>[0]) => {
    if (actor.authMode !== "oidc" || actor.issuer !== options.issuer || !actor.subjectId) throw new Error("Verified OIDC owner required");
    return { issuer: options.issuer, subjectId: actor.subjectId };
  };
  return {
    id: "voice_livekit",
    async ready() {
      if (!options.provider && !options.mediaNeverEnabled) return false;
      for (const store of options.stores) if (!store.erasureReady || !store.preflightActorErasure || !store.fenceActor || !store.purgeActor || !store.recordMediaGrant || !store.assertSubjectAllowed || !await store.erasureReady()) return false;
      return options.provider ? options.provider.ready(AbortSignal.timeout(5_000)) : true;
    },
    async preflight(actor, context) {
      const owner = verifiedOwner(actor), versions: string[] = [];
      for (const store of options.stores) {
        context.signal.throwIfAborted();
        if (!store.preflightActorErasure) return { ready: false, reason: "adapter_preflight_missing" };
        const result = await store.preflightActorErasure(owner);
        if (!result.ready) return { ready: false, reason: "ownership_unresolved" };
        versions.push(result.version);
      }
      context.signal.throwIfAborted();
      return { ready: true, version: createHash("sha256").update(JSON.stringify(versions)).digest("hex") };
    },
    async erase(actor, context) {
      const owner = verifiedOwner(actor), rooms: string[] = [], notBefore: string[] = [];
      for (const store of options.stores) {
        context.signal.throwIfAborted();
        if (!store.fenceActor || !store.purgeActor) return { status: "pending", remaining: "cleanup_pending" };
        const result = await store.fenceActor(owner, context.operationId, context.requestedAt);
        rooms.push(...result.calls.map(call => liveKitRoomName(call.callId)));
        notBefore.push(result.notBefore);
      }
      context.signal.throwIfAborted();
      if (options.provider) {
        if (!await options.provider.removeAndVerify(owner.subjectId, rooms, context.signal, { issuer: owner.issuer, operationId: context.operationId })) return { status: "pending", remaining: "cleanup_pending" };
        context.signal.throwIfAborted();
        // Active participant removal does not revoke unused JWTs. Wait for their
        // maximum proven lifetime before final removal and local history cleanup.
        if (notBefore.some(value => Date.parse(value) > (options.now?.() ?? new Date()).getTime())) return { status: "pending", remaining: "cleanup_pending" };
        if (!await options.provider.removeAndVerify(owner.subjectId, rooms, context.signal, { issuer: owner.issuer, operationId: context.operationId })) return { status: "pending", remaining: "cleanup_pending" };
      } else if (!options.mediaNeverEnabled) return { status: "pending", remaining: "cleanup_pending" };
      let complete = true;
      for (const store of options.stores) {
        context.signal.throwIfAborted();
        if (!(await store.purgeActor!(owner, context.operationId, context.requestedAt)).complete) complete = false;
      }
      context.signal.throwIfAborted();
      if (!complete) return { status: "pending", remaining: "cleanup_pending" };
      return { status: "completed", proofId: createHash("sha256").update(JSON.stringify(["voice-livekit-erasure-v1", context.operationId, context.accountKey])).digest("hex") };
    }
  };
}

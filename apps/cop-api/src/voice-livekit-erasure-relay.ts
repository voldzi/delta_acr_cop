import { AccessToken } from "livekit-server-sdk";
import { readBoundedBody } from "./bounded-upstream.js";
import { removeAndVerifyLiveKitParticipant, type LiveKitErasureClient, type VoiceErasureProvider } from "./voice-livekit-erasure.js";

const contractVersion = "cop-livekit-erasure-v1";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const roomPattern = /^cop-call-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
type Action = "probe" | "list_rooms" | "room_exists" | "own_presence" | "remove_self";
type Context = { issuer: string; operationId: string; subjectId: string };

/** Existing HTTPS Messaging authority carries a short-lived LiveKit grant;
 * no long-lived LiveKit secret leaves COP and no public admin route is added. */
export class MessagingLiveKitErasureProvider implements VoiceErasureProvider {
  private readonly endpoint: URL;
  constructor(private readonly options: { baseUrl: string; serviceToken: string; issuer: string; apiKey: string; apiSecret: string }) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) ||
      !options.serviceToken || !options.issuer || !options.apiKey || !options.apiSecret) throw new Error("Trusted HTTPS Messaging relay and existing server credentials required");
    this.endpoint = new URL("/api/v1/communication/voice-erasure", url);
  }
  async ready(signal: AbortSignal): Promise<boolean> {
    try { return (await this.invoke("probe", signal)).ready === true; } catch { return false; }
  }
  async removeAndVerify(subjectId: string, rooms: readonly string[], signal: AbortSignal, context?: { issuer: string; operationId: string }): Promise<boolean> {
    if (!context || context.issuer !== this.options.issuer || !uuid.test(context.operationId) || !uuid.test(subjectId)) throw new Error("Bound voice erasure actor and operation required");
    const bound: Context = { ...context, subjectId };
    const client: LiveKitErasureClient = {
      listRooms: async names => {
        if (names && (names.length !== 1 || !roomPattern.test(names[0]!))) throw new Error("Unproven COP room probe");
        const response = await this.invoke(names ? "room_exists" : "list_rooms", signal, bound, names?.[0]);
        const list = response.roomNames;
        if (!Array.isArray(list) || list.length > 10_000 || !list.every(name => typeof name === "string" && roomPattern.test(name)) ||
          new Set(list).size !== list.length || (names && list.some(name => name !== names[0]))) throw new Error("VOICE_RELAY_RESPONSE_UNPROVEN");
        return list.map(name => ({ name }));
      },
      listParticipants: async room => {
        const response = await this.invoke("own_presence", signal, bound, room);
        if (typeof response.subjectPresent !== "boolean") throw new Error("VOICE_RELAY_RESPONSE_UNPROVEN");
        return response.subjectPresent ? [{ identity: subjectId }] : [];
      },
      removeParticipant: async (room, identity) => {
        if (identity !== subjectId) throw new Error("Foreign voice identity forbidden");
        const response = await this.invoke("remove_self", signal, bound, room);
        if (response.subjectPresent !== false) throw new Error("VOICE_RELAY_REMOVAL_UNPROVEN");
      }
    };
    return removeAndVerifyLiveKitParticipant(client, subjectId, rooms, signal);
  }
  private async invoke(action: Action, signal: AbortSignal, context?: Context, roomName?: string): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    if (roomName !== undefined && !roomPattern.test(roomName)) throw new Error("Unproven COP room");
    const token = new AccessToken(this.options.apiKey, this.options.apiSecret, { ttl: 30 });
    token.addGrant(action === "probe" || action === "list_rooms" || action === "room_exists" ? { roomList: true } : { roomAdmin: true, room: roomName });
    const grant = await token.toJwt(); signal.throwIfAborted();
    const response = await fetch(this.endpoint, { method: "POST", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      headers: { authorization: `Bearer ${this.options.serviceToken}`, "x-cop-livekit-grant": grant, "content-type": "application/json", "cache-control": "no-store",
        ...(context ? { "x-csm-user-id": context.subjectId, "x-csm-oidc-issuer": context.issuer } : {}) },
      body: JSON.stringify({ contractVersion, action, ...(context ? { operationId: context.operationId } : {}), ...(roomName ? { roomName } : {}) }) });
    if (response.status !== 200) { await response.body?.cancel(); throw new Error("VOICE_RELAY_UNAVAILABLE"); }
    const body: unknown = JSON.parse((await readBoundedBody(response, 1_048_576)).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("VOICE_RELAY_RESPONSE_UNPROVEN");
    const value = body as Record<string, unknown>;
    const key = action === "probe" ? "ready" : action === "list_rooms" || action === "room_exists" ? "roomNames" : "subjectPresent";
    if (value.contractVersion !== contractVersion || Object.keys(value).sort().join(",") !== ["contractVersion", key].sort().join(",")) throw new Error("VOICE_RELAY_RESPONSE_UNPROVEN");
    return value;
  }
}

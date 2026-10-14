import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveKitVoiceErasureProvider } from "./voice-livekit-erasure.js";

const roomA = "cop-call-52be9d0b-c1ca-46c1-b962-d0066cdb8922";
const lostRoom = "cop-call-11f5b5fe-e3f6-44b5-aab6-eaa2a9d58d54";
const signal = new AbortController().signal;
afterEach(() => { vi.restoreAllMocks(); });

function syntheticProvider(options: { refuseRemoval?: boolean; excessive?: boolean; changedInventory?: boolean } = {}) {
  const roomMembers = new Map([[roomA, ["actor-a", "actor-b"]], [lostRoom, ["actor-a", "actor-c"]], ["another-app-room", ["actor-a", "actor-d"]]]);
  const calls: Array<{ method: string; room?: string; identity?: string; names?: string[] }> = [];
  let inventories = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (resource, request) => {
    const url = new URL(typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url);
    expect(url.origin).toBe("https://synthetic-livekit.example.test");
    const method = url.pathname.split("/").at(-1)!;
    const body = JSON.parse(String(request?.body ?? "{}")) as { room?: string; identity?: string; names?: string[] };
    // Capture request scope only. Authorization JWTs are never retained/logged.
    calls.push({ method, ...body });
    if (method === "ListRooms") {
      const names = body.names?.length ? body.names.filter(name => roomMembers.has(name)) : [...roomMembers.keys()];
      if (!body.names?.length) inventories++;
      if (options.changedInventory && inventories > 1 && !body.names?.length) names.push("cop-call-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      if (options.excessive) return Response.json({ rooms: Array.from({ length: 10_001 }, (_, index) => ({ name: `room-${index}` })) });
      return Response.json({ rooms: names.map(name => ({ name, sid: `synthetic-${name}` })) });
    }
    if (method === "ListParticipants") return Response.json({ participants: (roomMembers.get(body.room!) ?? []).map(identity => ({ identity, sid: `synthetic-${identity}` })) });
    if (method === "RemoveParticipant") {
      if (!options.refuseRemoval) roomMembers.set(body.room!, (roomMembers.get(body.room!) ?? []).filter(identity => identity !== body.identity));
      return Response.json({});
    }
    throw new Error("Unexpected synthetic LiveKit method");
  });
  const provider = new LiveKitVoiceErasureProvider({ adminUrl: "https://synthetic-livekit.example.test", apiKey: "synthetic-key", apiSecret: "synthetic-secret-does-not-authorize-real-provider" });
  return { provider, calls, roomMembers };
}

describe("LiveKit erasure actual SDK request boundary with synthetic transport", () => {
  it("probes only one explicit room and removes the exact actor in COP rooms, including a lost memory record", async () => {
    const { provider, calls, roomMembers } = syntheticProvider();
    expect(await provider.ready(signal)).toBe(true);
    expect(calls).toEqual([{ method: "ListRooms", names: ["cop-erasure-readiness-probe"] }]);
    expect(await provider.removeAndVerify("actor-a", [roomA], signal)).toBe(true);
    expect(calls.filter(call => call.method === "RemoveParticipant")).toEqual([
      { method: "RemoveParticipant", room: lostRoom, identity: "actor-a" },
      { method: "RemoveParticipant", room: roomA, identity: "actor-a" }
    ]);
    expect(roomMembers.get(roomA)).toEqual(["actor-b"]);
    expect(roomMembers.get(lostRoom)).toEqual(["actor-c"]);
    expect(roomMembers.get("another-app-room")).toEqual(["actor-a", "actor-d"]);
    expect(calls.every(call => call.method !== "DeleteRoom")).toBe(true);
  });
  it("requires actual participant absence and fails closed on changed/excessive inventory", async () => {
    expect(await syntheticProvider({ refuseRemoval: true }).provider.removeAndVerify("actor-a", [roomA], signal)).toBe(false);
    vi.restoreAllMocks();
    expect(await syntheticProvider({ changedInventory: true }).provider.removeAndVerify("actor-a", [roomA], signal)).toBe(false);
    vi.restoreAllMocks();
    await expect(syntheticProvider({ excessive: true }).provider.removeAndVerify("actor-a", [roomA], signal)).rejects.toThrow("inventory exceeds verified bound");
  });
  it("rejects untrusted admin URLs, foreign room names and cancelled work before any provider mutation", async () => {
    expect(() => new LiveKitVoiceErasureProvider({ adminUrl: "http://synthetic-livekit.example.test", apiKey: "synthetic", apiSecret: "synthetic" })).toThrow("Trusted HTTPS");
    const { provider, calls } = syntheticProvider();
    await expect(provider.removeAndVerify("actor-a", ["another-app-room"], signal)).rejects.toThrow("Unproven COP room");
    const controller = new AbortController(); controller.abort();
    await expect(provider.removeAndVerify("actor-a", [roomA], controller.signal)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

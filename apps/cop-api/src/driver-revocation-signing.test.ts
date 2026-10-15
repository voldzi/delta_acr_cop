import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpDriverMeasurementSource } from "./driver-measurement-source.js";
import { contributorIdDay } from "./driver-measurement-contract.js";

const issuer = "https://identity.revocation.test/cop", actorSecret = "synthetic-actor-secret-more-than-32-characters";
const contributorSecret = "synthetic-contributor-secret-more-than-32-characters", day = "2026-10-15";
const now = new Date("2026-10-15T10:00:00.000Z");
const identity = (subjectId: string) => ({ subjectId, contributorDay: day, actorSource: "consent_ledger" as const });
const id = (subjectId: string) => contributorIdDay(contributorSecret, subjectId, day);
const result = () => new Response(JSON.stringify({ contractVersion: "sim-driver-measurements-v1", deletedBatchCount: 0 }),
  { status: 200, headers: { "content-type": "application/json" } });
const source = () => new HttpDriverMeasurementSource("https://sim.revocation.test/internal", "synthetic-service-token", 500,
  { issuer, actorSecret, contributorSecret, now: () => now });
afterEach(() => vi.unstubAllGlobals());
describe("server-signed per-user driver revocation", () => {
  it("signs two isolated server identities, exact UTC day/body and canonical eight-field claim", async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => { requests.push(options); return result(); }));
    for (const subject of ["synthetic-a", "synthetic-b"]) await source().delete(id(subject), identity(subject));
    expect(requests).toHaveLength(2);
    for (const [i, subject] of ["synthetic-a", "synthetic-b"].entries()) {
      const headers = requests[i]!.headers as Record<string, string>, encoded = headers["x-cop-actor"]!;
      const claim = JSON.parse(Buffer.from(encoded, "base64url").toString());
      expect(Object.keys(claim)).toEqual(["iss", "sub", "aud", "iat", "exp", "contributorDay", "contributorIdDay", "actorSource"]);
      expect(claim).toEqual({ iss: issuer, sub: subject, aud: "sim-driver-revocation", iat: now.getTime() / 1000,
        exp: now.getTime() / 1000 + 60, contributorDay: day, contributorIdDay: id(subject), actorSource: "consent_ledger" });
      expect(headers["x-cop-actor-signature"]).toBe(createHmac("sha256", actorSecret).update(encoded).digest("hex"));
      expect(JSON.parse(requests[i]!.body as string)).toEqual({ contractVersion: "sim-driver-measurements-v1", contributorIdDay: id(subject) });
      expect(requests[i]!.redirect).toBe("error");
    }
    expect((requests[0]!.headers as Record<string, string>)["x-cop-actor"]).not.toBe((requests[1]!.headers as Record<string, string>)["x-cop-actor"]);
  });
  it("rejects missing identity, crossed users, invalid day and controls before any outgoing request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const [contributor, actor] of [[id("synthetic-a"), undefined], [id("synthetic-b"), identity("synthetic-a")],
      [id("synthetic-a"), { ...identity("synthetic-a"), contributorDay: "2026-02-30" }],
      [id("synthetic-a"), { ...identity("synthetic-a"), subjectId: "unsafe\nsubject" }]] as const)
      await expect(source().delete(contributor, actor)).rejects.toMatchObject({ statusCode: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps explicit unconfigured legacy transport; configured signing never downgrades on error", async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => { requests.push(options); return result(); }));
    await new HttpDriverMeasurementSource("https://sim.revocation.test/internal", "synthetic-service-token").delete(id("synthetic-a"));
    expect(requests[0]!.headers).not.toHaveProperty("x-cop-actor");
    await expect(source().delete(id("synthetic-a"))).rejects.toMatchObject({ statusCode: 503 });
    expect(requests).toHaveLength(1);
  });
});

import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createSimMeasurementsAccountErasureAdapter, createSimRouterAccountErasureAdapter, type SimMeasurementsErasureOptions } from "./sim-account-erasure.js";
import { opaqueUserId } from "./ai-router-chat.js";
import { contributorIdDay } from "./driver-measurement-contract.js";
import type { AuthenticatedActor } from "./security.js";
const issuer = "https://synthetic-erasure.test/realms/cop", a = "af004565-6cbe-46c3-9ab1-cd9f9884de19", b = "bf004565-6cbe-46c3-9ab1-cd9f9884de19", op = "df004565-6cbe-46c3-9ab1-cd9f9884de19";
const actorSecret = "synthetic-signing-secret-".repeat(3), userIdSecret = "synthetic-existing-router-secret-".repeat(3), dailySecret = "synthetic-existing-driver-secret-".repeat(3);
const actor = (subjectId = a): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId, username: "not-forwarded", displayName: "not-forwarded", email: "not-forwarded@example.test" });
const context = () => ({ operationId: op, accountKey: "not-forwarded", requestedAt: "2026-10-14T12:00:00.000Z", signal: new AbortController().signal });
const serviceChecks = { schemaReady: true, permissionsReady: true, identityReviewed: true, restoreCheckpointCurrent: true, retentionReviewed: true };
const routerReceipt = () => ({ contractVersion: "sim-account-erasure-v1", operationId: op, status: "online_complete", scope: "cop_router_primary_database", pendingReasons: [], pendingRequestCount: 0,
  onlineScopeComplete: true, wholeAccountComplete: false, backupsComplete: false, providerRetentionComplete: false, retainedMinimumReplayFence: true, aliasScope: "sim_izs_preserved_out_of_scope" });
const driverReceipt = (acceptedAt: string, contributorCount = 9) => ({ contractVersion: "sim-account-erasure-v1", operationId: op, status: "completed", scope: "online_driver_scope", wholeAccountComplete: false, backupReplayRequired: true,
  acceptedAt, updatedAt: acceptedAt, contributorCount, deletedBatchCount: 1, remainingBatchCount: 0, databaseZeroVerified: true, derivedReportAcknowledged: true,
  reportProtection: "no_report", publicationFenceVerified: true, replayReady: true, retentionReviewed: true, pendingReason: null });
type Request = { path: string; method: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> | null; claim?: Record<string, unknown> };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture(reply?: (request: Request) => { status?: number; body?: unknown; headers?: Record<string, string>; stall?: boolean } | undefined) {
  const requests: Request[] = [], anchor = new Map<string, { acceptedAt: string; contributorCount: number }>();
  let now = new Date("2026-10-14T12:00:00.000Z");
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part)); const raw = Buffer.concat(parts).toString("utf8");
    const encoded = req.headers["x-cop-actor"], claim = typeof encoded === "string" ? JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown> : undefined;
    const request = { path: req.url!, method: req.method!, headers: req.headers, body: raw ? JSON.parse(raw) as Record<string, unknown> : null, claim }; requests.push(request);
    const custom = reply?.(request);
    let result = custom;
    if (!result) {
      const driver = request.path.includes("driver-measurements"), owner = driver ? "sim_measurements" : "ai_router", scope = driver ? "online_driver_scope" : "cop_router_primary_database";
      if (request.path.endsWith("/capability") || request.path.endsWith("/preflight")) {
        const isActor = request.path.endsWith("/preflight");
        const envelope = { contractVersion: "sim-account-erasure-v1", owner, scope, enabled: true, ready: true, checkedAt: now.toISOString(), blockers: [], mutates: false, providerCalls: false, wholeAccountComplete: false };
        const checks = { ...serviceChecks, ...(driver ? { publicationFenceVerified: true } : {}), ...(isActor ? { identityBindingReviewed: true, ...(driver ? { manifestShapeAndCoverageValid: true } : { providerRequestsSettled: true }) } : {}) };
        const stored = anchor.get(String(claim?.sub));
        result = { body: { ...envelope, checks, ...(driver ? { reportProtection: "no_report" } : { costPolicy: "aggregate-costs-current-month-v1" }), ...(isActor ? { operationId: op,
          identityBinding: driver ? "cop_attested_daily_manifest" : "cop_attested_existing_router_alias", ...(driver ? { manifestValid: true, contributorCount: (request.body?.contributors as unknown[]).length,
            coverageAnchor: { kind: stored ? "first_accepted_at" : "checked_at", at: stored?.acceptedAt ?? now.toISOString() } } : {}) } : {}) } };
      } else if (driver && request.method === "GET") { const stored = anchor.get(String(claim?.sub)); result = stored ? { body: driverReceipt(stored.acceptedAt, stored.contributorCount) } : { status: 404, body: {} }; }
      else if (driver) { const stored = anchor.get(String(claim?.sub)) ?? { acceptedAt: now.toISOString(), contributorCount: (request.body?.contributors as unknown[]).length }; anchor.set(String(claim?.sub), stored); result = { body: driverReceipt(stored.acceptedAt, stored.contributorCount) }; }
      else result = { body: routerReceipt() };
    }
    res.writeHead(result.status ?? 200, { "content-type": "application/json", "cache-control": "no-store", ...result.headers });
    if (result.stall) { res.write("{"); return; } res.end(JSON.stringify(result.body ?? {}));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("synthetic fixture unavailable"); const origin = `http://127.0.0.1:${address.port}`;
  const options: SimMeasurementsErasureOptions = { baseUrl: origin, token: "synthetic-internal-service-token-".repeat(2), issuer, actorSecret, userIdSecret, timeoutMs: 500, now: () => now,
    verifyConfiguredOwner: async (_owner, context) => context.origin === origin,
    reviewExistingIdentity: async (actor, context) => ({ reviewed: context.routerUserId === opaqueUserId(userIdSecret, actor.subjectId), version: "a".repeat(64) }) as { reviewed: true; version: string },
    inventory: async () => ({ version: "b".repeat(64), retainedComplete: true, outboxComplete: true, keyVersionsComplete: true, retainedDays: [], outboxDays: [], keys: [{ version: "actual-v1", secret: dailySecret }] }) };
  return { options, requests, anchor, setNow: (value: string) => { now = new Date(value); } };
}
describe("SIM COP-only erasure adapters", () => {
  it("defaults unavailable without actual native and issuer/legacy provenance authority", async () => {
    const f = await fixture();
    expect(await createSimRouterAccountErasureAdapter({ ...f.options, verifyConfiguredOwner: undefined }).ready()).toBe(false);
    expect(await createSimRouterAccountErasureAdapter({ ...f.options, reviewExistingIdentity: undefined }).ready()).toBe(false);
    expect(await createSimMeasurementsAccountErasureAdapter({ ...f.options, inventory: undefined }).ready()).toBe(false);
    expect(await createSimRouterAccountErasureAdapter({ ...f.options, reviewExistingIdentity: undefined }).preflight!(actor(), { ...context() })).toEqual({ ready: false, reason: "adapter_unavailable" });
    expect(f.requests.every(r => r.path.endsWith("/capability") && !r.claim)).toBe(true);
  });
  it("emits exactly seven ordered purpose claims, legacy alias, HMAC and isolated A/B identities", async () => {
    const f = await fixture(), adapter = createSimRouterAccountErasureAdapter(f.options);
    expect(await adapter.ready()).toBe(true); expect(await adapter.preflight!(actor(), context())).toMatchObject({ ready: true });
    const x = await adapter.erase(actor(a), context()), y = await adapter.erase(actor(b), context());
    expect(x.status).toBe("completed"); expect(y.status).toBe("completed"); expect(x).not.toEqual(y);
    const calls = f.requests.filter(r => r.claim);
    expect(calls.map(r => r.claim!.sub)).toEqual([a, a, b]);
    for (const request of calls) {
      expect(Object.keys(request.claim!)).toEqual(["iss", "sub", "aud", "iat", "exp", "operationId", "routerUserId"]);
      expect(request.claim!.iss).toBe(issuer); expect(request.claim!.aud).toBe("sim-account-erasure"); expect(Number(request.claim!.exp) - Number(request.claim!.iat)).toBe(60);
      expect(request.claim!.routerUserId).toBe(opaqueUserId(userIdSecret, String(request.claim!.sub)));
      expect(request.headers["x-cop-actor-signature"]).toBe(createHmac("sha256", actorSecret).update(String(request.headers["x-cop-actor"])).digest("hex"));
      expect(request.headers.origin).toBeUndefined(); expect(request.body).toEqual({ contractVersion: "sim-account-erasure-v1", operationId: op });
    }
    expect(f.requests.filter(r => r.path.endsWith("/capability")).every(r => !r.headers["x-cop-actor"] && r.body === null)).toBe(true);
  });
  it("does not accept global health/label readiness when typed native/current-store checks disagree", async () => {
    const f = await fixture(r => r.path.endsWith("capability") ? { body: { contractVersion: "sim-account-erasure-v1", owner: "ai_router", scope: "cop_router_primary_database", enabled: true, ready: true,
      checkedAt: "2026-10-14T12:00:00.000Z", blockers: [], mutates: false, providerCalls: false, wholeAccountComplete: false, checks: { ...serviceChecks, restoreCheckpointCurrent: false }, costPolicy: "aggregate-costs-current-month-v1" } } : undefined);
    expect(await createSimRouterAccountErasureAdapter(f.options).ready()).toBe(false);
  });
  it.each([{ ...actor(), authMode: "lab" as const }, { ...actor(), issuer: "https://wrong.test" }, { ...actor(), subjectId: "bad\nsub" }])("rejects unsigned/foreign actor before provider calls %#", async invalid => {
    const f = await fixture(); await expect(createSimRouterAccountErasureAdapter(f.options).erase(invalid, context())).rejects.toMatchObject({ status: 401 }); expect(f.requests).toEqual([]);
  });
  it.each([{ ...routerReceipt(), operationId: b }, { ...routerReceipt(), aliasScope: "all_aliases_deleted" }, { ...routerReceipt(), wholeAccountComplete: true },
    { ...routerReceipt(), backupsComplete: true }, { ...routerReceipt(), providerRetentionComplete: true }, { ...routerReceipt(), pendingRequestCount: 1 }, { ...routerReceipt(), onlineScopeComplete: false },
    { ...routerReceipt(), pendingReasons: ["provider_requests_pending"] }, {}, { ...routerReceipt(), scope: "online_driver_scope" }])("never adopts partial/foreign/whole or empty Router ACK %#", async body => {
    const f = await fixture(r => !r.path.endsWith("capability") ? { body } : undefined);
    expect(await createSimRouterAccountErasureAdapter(f.options).erase(actor(), context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
  });
  it.each([202, 401, 403, 409, 429, 503])("HTTP %i cannot become completion or direct model fallback", async status => {
    const f = await fixture(r => !r.path.endsWith("capability") ? { status, body: routerReceipt() } : undefined);
    expect(await createSimRouterAccountErasureAdapter(f.options).erase(actor(), context())).toMatchObject({ status: "pending" });
    expect(f.requests.every(r => !r.path.includes("generate") && !r.path.includes("openai-key"))).toBe(true);
  });
  it("driver manifest uses actual historical versions/retained/outbox inventory and only transient daily HMACs", async () => {
    const f = await fixture(); f.options.inventory = async () => ({ version: "c".repeat(64), retainedComplete: true, outboxComplete: true, keyVersionsComplete: true,
      retainedDays: ["2026-10-04"], outboxDays: ["2026-10-05"], keys: [{ version: "actual-old", secret: dailySecret }, { version: "actual-current", secret: "synthetic-rotated-secret-".repeat(3) }] });
    const adapter = createSimMeasurementsAccountErasureAdapter(f.options);
    expect(await adapter.ready()).toBe(true); expect(await adapter.preflight!(actor(), context())).toMatchObject({ ready: true });
    expect(await adapter.erase(actor(), context())).toMatchObject({ status: "completed" });
    const writes = f.requests.filter(r => r.method === "POST" && r.path.includes("driver-measurements")); const sent = writes.at(-1)!.body!;
    expect(Object.keys(sent)).toEqual(["contractVersion", "operationId", "contributors", "attestation"]);
    const contributors = sent.contributors as Array<{ contributorDay: string; contributorIdDay: string }>;
    expect(contributors).toHaveLength(22); expect(contributors).toContainEqual({ contributorDay: "2026-10-04", contributorIdDay: contributorIdDay(dailySecret, a, "2026-10-04") });
    expect(contributors.every(v => Object.keys(v).join(",") === "contributorDay,contributorIdDay")).toBe(true);
    expect(JSON.stringify(sent)).not.toContain(dailySecret); expect(JSON.stringify(sent)).not.toContain("actual-old"); expect(JSON.stringify(sent)).not.toContain(a);
  });
  it("unknown versions, absent inventory or >40 entries fail closed and never silently truncate", async () => {
    const f = await fixture(); f.options.inventory = async () => null;
    expect(await createSimMeasurementsAccountErasureAdapter(f.options).erase(actor(), context())).toMatchObject({ status: "pending" });
    f.options.inventory = async () => ({ version: "c".repeat(64), retainedComplete: true, outboxComplete: true, keyVersionsComplete: true, retainedDays: ["2026-09-01", "2026-09-02"], outboxDays: [], keys: Array.from({ length: 4 }, (_, i) => ({ version: `actual-${i}`, secret: ("synthetic-history-" + i).repeat(4) })) });
    expect(await createSimMeasurementsAccountErasureAdapter(f.options).preflight!(actor(), context())).toMatchObject({ ready: false });
    expect(f.requests.every(r => r.method === "GET")).toBe(true);
  });
  it("retry through UTC midnight uses actual first acceptedAt and immutable operation manifest", async () => {
    const f = await fixture(); f.setNow("2026-10-14T23:59:50.000Z"); const adapter = createSimMeasurementsAccountErasureAdapter(f.options);
    expect(await adapter.erase(actor(), context())).toMatchObject({ status: "completed" });
    f.setNow("2026-10-15T00:00:20.000Z"); expect(await adapter.erase(actor(), context())).toMatchObject({ status: "completed" });
    const posts = f.requests.filter(r => r.method === "POST"); expect(posts[0]!.body).toEqual(posts[1]!.body);
    expect((posts[0]!.body!.contributors as unknown[])).toHaveLength(10); expect(posts[0]!.claim!.iat).not.toBe(posts[1]!.claim!.iat);
    expect(f.requests.filter(r => r.method === "GET" && !r.path.endsWith("capability")).every(r => r.path.endsWith("/" + op) && r.body === null)).toBe(true);
  });
  it("preflight versions remain stable across checkedAt changes within the same impact window", async () => {
    const f = await fixture(), adapter = createSimMeasurementsAccountErasureAdapter(f.options), first = await adapter.preflight!(actor(), context());
    f.setNow("2026-10-14T12:00:01.000Z"); expect(await adapter.preflight!(actor(), context())).toEqual(first);
  });
  it.each([{ databaseZeroVerified: false }, { remainingBatchCount: 1 }, { derivedReportAcknowledged: false }, { publicationFenceVerified: false }, { replayReady: false },
    { retentionReviewed: false }, { reportProtection: "unverified" }, { contributorCount: 10 }, { pendingReason: "publisher_review_required" }, { wholeAccountComplete: true }])("driver DB-zero alone and unproven report/restore/retention/count never become complete %#", async change => {
    const f = await fixture(r => r.method === "POST" && !r.path.endsWith("preflight") ? { body: { ...driverReceipt("2026-10-14T12:00:00.000Z"), ...change } } : undefined);
    expect(await createSimMeasurementsAccountErasureAdapter(f.options).erase(actor(), context())).toMatchObject({ status: "pending" });
  });
  it("rejects redirect, stale probe, oversized body and timeout without forwarding actor credentials", async () => {
    const redirect = await fixture(() => ({ status: 302, headers: { location: "https://never-call-public.test" } }));
    expect(await createSimRouterAccountErasureAdapter(redirect.options).ready()).toBe(false); expect(redirect.requests).toHaveLength(1);
    const huge = await fixture(() => ({ body: { padding: "x".repeat(20_000) } })); expect(await createSimRouterAccountErasureAdapter(huge.options).ready()).toBe(false);
    const stalled = await fixture(() => ({ stall: true })); stalled.options.timeoutMs = 25; expect(await createSimRouterAccountErasureAdapter(stalled.options).ready()).toBe(false);
  });
});

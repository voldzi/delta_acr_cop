import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessagingAccountErasureAdapter, createMessagingMobilityProviderEffects, type MessagingAccountErasureOptions } from "./messaging-account-erasure.js";
import type { AuthenticatedActor } from "./security.js";
import type { MobilityProviderManifest } from "./mobility-account-erasure.js";

const issuer = "https://synthetic-messaging.test/realms/cop";
const a = "af004565-6cbe-46c3-9ab1-cd9f9884de19", b = "bf004565-6cbe-46c3-9ab1-cd9f9884de19", op = "df004565-6cbe-46c3-9ab1-cd9f9884de19";
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const actor = (subjectId = a): AuthenticatedActor => ({ authMode: "oidc", issuer, subjectId, username: "not-forwarded", displayName: "not-forwarded", email: "not-forwarded@example.test" });
const context = () => ({ operationId: op, accountKey: "not-forwarded", requestedAt: "2026-10-14T09:00:00Z", signal: new AbortController().signal });
const manifest: MobilityProviderManifest = { version: 1, invitationIds: [b], notificationIdempotencyKeys: [`cop-mobility-invitation-v1:${b}:${a}`], conversationIds: ["conv_synthetic"], roomIds: ["!synthetic:example.test"] };
const scope = () => ({ appScope: "cop_jizda_exclusive" as const, scopeVersion: "e".repeat(64), exclusiveBindingProven: true as const, simNamespacePreserved: true as const, scopeCoverage: ["matrix", "notifications", "conversations", "devices", "policy_metadata"] as const });
const whole = (user = a, operationId = op) => ({ contractVersion: "csm-account-erasure-owner-v2", operationId, status: "completed", wholeAccountErased: true,
  ...scope(), localOwnerDataErased: true, externalCopiesErased: false, revocationEnforced: true, remaining: [], technicalRetentionPolicyId: "matrix-opaque-protocol-tombstones-v1", proofId: digest([user, operationId]) });
const effects = () => ({ contractVersion: "csm-cop-mobility-effects-erasure-v1", operationId: op, status: "completed", localMetadataErased: true,
  ...scope(), sourceRevocationEnforced: true, wholeAccountErased: false, externalCopiesErased: false, remaining: [], proofId: digest(manifest) });
const readiness = () => ({ ...scope(), contractVersion: "csm-account-erasure-owner-readiness-v1", wholeAccountReady: true, localContentProviderReady: true, version: digest(a), remaining: [] });
const capabilities = () => ({ contractVersion: "csm-cop-mobility-effects-erasure-v1", localMetadataErasure: true, wholeAccountErasure: false, externalCopiesErased: false });
type Request = { path: string; method: string; headers: IncomingMessage["headers"]; body: unknown };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const close of cleanups.splice(0)) await close(); });
async function fixture(responder?: (request: Request) => { status?: number; body?: unknown; headers?: Record<string, string>; stall?: boolean }) {
  const requests: Request[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const request: Request = { path: req.url!, method: req.method!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined }; requests.push(request);
    const result = responder?.(request) ?? { body: request.path.endsWith("preflight") ? readiness() : request.path.endsWith("capabilities") ? capabilities()
      : request.path.endsWith("owner-v2") ? whole(String(request.headers["x-csm-user-id"]), String(request.headers["idempotency-key"])) : effects() };
    res.writeHead(result.status ?? 200, { "content-type": "application/json", ...result.headers });
    if (result.stall) { res.write("{"); return; }
    res.end(JSON.stringify(result.body ?? {}));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("synthetic server unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  const verify = vi.fn(async (_scope: string, bound: { origin: string }) => bound.origin === origin);
  const options: MessagingAccountErasureOptions = { issuer, config: { enabled: true, baseUrl: origin, publicUrl: "https://never-call-public.test", matrixHomeserverPublicUrl: "https://never-call-matrix.test", cacheTtlMs: 1, timeoutMs: 500, token: "synthetic-internal-service-token" }, verifyConfiguredOwner: verify, verifyActorScope: async () => scope() };
  return { requests, options, verify };
}

describe("Messaging whole and exact mobility owner adapters", () => {
  it("database mode verifies actual authenticated feature and exclusive actor scope without native callbacks", async () => {
    const f = await fixture();
    const adapter = createMessagingAccountErasureAdapter({ ...f.options, authorityMode: "database_v2",
      verifyConfiguredOwner: undefined, verifyActorScope: undefined });
    expect(await adapter.ready()).toBe(true);
    expect(await adapter.preflight!(actor(a), context())).toMatchObject({ ready: true });
    expect((await adapter.erase(actor(a), context())).status).toBe("completed");
    expect(f.requests.some(r => r.path.endsWith("/capabilities"))).toBe(true);
    expect(f.requests.filter(r => r.path.endsWith("/preflight")).every(r => r.headers["x-csm-user-id"] === a)).toBe(true);
    expect(f.requests.every(r => r.headers.authorization === "Bearer " + f.options.config.token)).toBe(true);
  });
  it.each([
    ["database_v2", "cop-messaging-minimal-technical-retention", "completed"],
    ["native_v1", "cop-messaging-minimal-technical-retention", "pending"],
    ["database_v2", "unknown-policy", "pending"],
    ["database_v2", "cop-messaging-full-v2-credential-synthetic-candidate", "pending"],
    ["database_v2", "cop-messaging-minimal-technical-retention-extra", "pending"]
  ] as const)("binds the exact reviewed policy to authority %s: %s", async (authorityMode, policy, status) => {
    const f = await fixture(r => ({ body: r.path.endsWith("preflight") ? readiness() : r.path.endsWith("capabilities") ? capabilities()
      : { ...whole(), technicalRetentionPolicyId: policy } }));
    const adapter = createMessagingAccountErasureAdapter({ ...f.options, authorityMode });
    expect((await adapter.erase(actor(a), context())).status).toBe(status);
  });
  it("database mode refuses unknown/shared namespace before the destructive owner request", async () => {
    const f = await fixture(r => ({ body: r.path.endsWith("capabilities") ? capabilities() : { ...readiness(), exclusiveBindingProven: false } }));
    const native = vi.fn(async () => true);
    const adapter = createMessagingAccountErasureAdapter({ ...f.options, authorityMode: "database_v2", verifyConfiguredOwner: native, verifyActorScope: undefined });
    expect(await adapter.preflight!(actor(a), context())).toMatchObject({ ready: false });
    expect((await adapter.erase(actor(a), context())).status).toBe("pending");
    expect(f.requests.some(r => r.path.endsWith("owner-v2"))).toBe(false); expect(native).not.toHaveBeenCalled();
  });
  it("has no fabricated actor/global whole cap and requires actual configured-owner verifier", async () => {
    const f = await fixture(), absent = { ...f.options, verifyConfiguredOwner: undefined };
    expect(await createMessagingAccountErasureAdapter(absent).ready()).toBe(false);
    expect(await createMessagingMobilityProviderEffects(absent).ready()).toBe(false);
    expect(await createMessagingAccountErasureAdapter(f.options).ready()).toBe(true);
    expect(f.requests).toEqual([]);
    expect(f.verify).toHaveBeenCalledWith("whole_owner", expect.objectContaining({ origin: f.options.config.baseUrl }));
  });
  it("uses each verified A/B actor, keeps all secrets/identity/profile fields out of body and preserves receipt isolation", async () => {
    const f = await fixture(), adapter = createMessagingAccountErasureAdapter(f.options);
    expect(await adapter.preflight!(actor(a), { signal: context().signal })).toEqual({ ready: true, version: digest(["csm-account-erasure-owner-v2", digest(a), scope().scopeVersion]) });
    const first = await adapter.erase(actor(a), context()), second = await adapter.erase(actor(b), context());
    expect(first).toEqual({ status: "completed", proofId: digest([a, op]) });
    expect(second).toEqual({ status: "completed", proofId: digest([b, op]) });
    expect(f.requests.map(r => [r.path, r.method, r.headers["x-csm-user-id"], r.headers["x-csm-oidc-issuer"], r.body])).toEqual([
      ["/api/v1/communication/account-erasure/preflight", "POST", a, issuer, {}],
      ["/api/v1/communication/account-erasure/owner-v2", "POST", a, issuer, {}],
      ["/api/v1/communication/account-erasure/owner-v2", "POST", b, issuer, {}]
    ]);
    expect(f.requests.slice(1).every(r => r.headers["idempotency-key"] === op)).toBe(true);
    expect(f.requests.every(r => !r.headers["x-csm-user-name"] && !r.headers["x-csm-user-email"] && r.headers["cache-control"] === "no-store")).toBe(true);
  });
  it.each([{ ...actor(), authMode: "lab" as const }, { ...actor(), issuer: "https://wrong.test" }, { ...actor(), subjectId: "bad\nheader" }])("rejects an unverified or foreign actor before all provider calls", async invalid => {
    const f = await fixture(), adapter = createMessagingAccountErasureAdapter(f.options);
    await expect(adapter.preflight!(invalid, { signal: context().signal })).rejects.toMatchObject({ status: 401 });
    await expect(adapter.erase(invalid, context())).rejects.toMatchObject({ status: 401 });
    expect(f.requests).toEqual([]);
  });
  it("maps actual owned-group blocker; malformed or absent native readiness stays unavailable", async () => {
    const f = await fixture(() => ({ body: { contractVersion: "csm-account-erasure-owner-readiness-v1", wholeAccountReady: false, localContentProviderReady: false, version: undefined, remaining: ["ownership_unresolved"] } }));
    expect(await createMessagingAccountErasureAdapter(f.options).preflight!(actor(), { signal: context().signal })).toEqual({ ready: false, reason: "ownership_unresolved" });
    f.options.verifyConfiguredOwner = async () => false;
    expect(await createMessagingAccountErasureAdapter(f.options).preflight!(actor(), { signal: context().signal })).toEqual({ ready: false, reason: "adapter_unavailable" });
    expect(f.requests).toHaveLength(1);
  });
  it.each([
    { status: 202, body: whole() }, { status: 200, body: {} }, { status: 200, body: { ...whole(), operationId: b } },
    { status: 200, body: { ...whole(), contractVersion: "csm-account-erasure-v1" } },
    { status: 200, body: { ...whole(), localOwnerDataErased: false } }, { status: 200, body: { ...whole(), externalCopiesErased: true } },
    { status: 200, body: { ...whole(), remaining: ["restore_continuity_readback"] } }, { status: 200, body: { ...whole(), technicalRetentionPolicyId: undefined } },
    { status: 200, body: { ...whole(), privateContext: "unexpected" } }, { status: 503, body: { error: { code: "UNAVAILABLE" } } },
    { status: 429, body: {} }, { status: 200, body: whole(), headers: { "content-type": "application/jsonp" } }
  ])("never promotes pending, foreign operation, v1, empty ACK, incomplete scope or failure into whole proof %#", async response => {
    const f = await fixture(() => response);
    expect(await createMessagingAccountErasureAdapter(f.options).erase(actor(), context())).toEqual({ status: "pending", remaining: "cleanup_pending" });
  });
  it("requires exact local source capabilities and actor-specific provenance before targeted effects", async () => {
    const f = await fixture(), adapter = createMessagingMobilityProviderEffects(f.options);
    expect(await adapter.ready()).toBe(true);
    expect(await adapter.preflight(actor(), context().signal)).toMatchObject({ ready: true });
    expect(await adapter.erase(actor(), manifest, context())).toEqual({ status: "completed", proofId: digest(manifest) });
    const post = f.requests.find(r => r.path === "/api/v1/communication/mobility-effects-erasure")!;
    expect(post.body).toEqual(manifest); expect(post.headers["x-csm-user-id"]).toBe(a); expect(post.headers["idempotency-key"]).toBe(op);
    expect(f.requests.every(r => !r.path.includes("matrix/token") && !r.path.endsWith("account-erasure"))).toBe(true);
  });
  it.each([{ ...manifest, owner: b }, { ...manifest, invitationIds: [b, b] }, { ...manifest, conversationIds: ["private\ntext"] }, { ...manifest, roomIds: ["非公開"] }, { ...manifest, notificationIdempotencyKeys: ["bad"] }])("rejects untyped/duplicate/free/invalid source manifest before any HTTP writes %#", async value => {
    const f = await fixture(); expect(await createMessagingMobilityProviderEffects(f.options).erase(actor(), value, context())).toMatchObject({ status: "pending" }); expect(f.requests).toEqual([]);
  });
  it.each([{ ...effects(), wholeAccountErased: true }, { ...effects(), sourceRevocationEnforced: false }, { ...effects(), operationId: b }, whole(), { ...effects(), remaining: ["notification_metadata"] }])("targeted cleanup cannot adopt whole receipt or an incomplete source fence %#", async body => {
    const f = await fixture(r => ({ body: r.path.endsWith("capabilities") ? capabilities() : body }));
    expect(await createMessagingMobilityProviderEffects(f.options).erase(actor(), manifest, context())).toMatchObject({ status: "pending" });
  });
  it("HTTP202 targeted receipt remains pending even with completion-looking booleans", async () => {
    const f = await fixture(r => ({ status: r.path.endsWith("capabilities") ? 200 : 202, body: r.path.endsWith("capabilities") ? capabilities() : effects() }));
    expect(await createMessagingMobilityProviderEffects(f.options).erase(actor(), manifest, context())).toMatchObject({ status: "pending" });
  });
  it("rejects a redirect without forwarding the service bearer or actor to the public origin", async () => {
    const f = await fixture(() => ({ status: 302, headers: { location: "https://never-call-public.test/private" } }));
    expect(await createMessagingAccountErasureAdapter(f.options).erase(actor(), context())).toMatchObject({ status: "pending" }); expect(f.requests).toHaveLength(1);
  });
  it("times out while reading a body and rejects oversized unframed response", async () => {
    const f = await fixture(() => ({ stall: true })); f.options.config.timeoutMs = 25;
    expect(await createMessagingAccountErasureAdapter(f.options).erase(actor(), context())).toMatchObject({ status: "pending" });
    const huge = await fixture(() => ({ body: { ...whole(), padding: "x".repeat(20_000) } }));
    expect(await createMessagingAccountErasureAdapter(huge.options).erase(actor(), context())).toMatchObject({ status: "pending" });
  });
  it("missing/shared/unknown actor-specific scope cannot reach any erasure POST even with accepted origin", async () => {
    const f = await fixture();
    for (const proof of [null, { ...scope(), appScope: "shared_with_sim" }, { ...scope(), exclusiveBindingProven: false }, { ...scope(), scopeCoverage: ["matrix"] }]) {
      const options = { ...f.options, verifyActorScope: async () => proof as ReturnType<typeof scope> | null };
      expect(await createMessagingAccountErasureAdapter(options).erase(actor(), context())).toMatchObject({ status: "pending" });
      expect(await createMessagingMobilityProviderEffects(options).erase(actor(), manifest, context())).toMatchObject({ status: "pending" });
    }
    expect(f.requests.every(r => r.method === "GET")).toBe(true);
    expect(await createMessagingAccountErasureAdapter({ ...f.options, verifyActorScope: undefined }).ready()).toBe(false);
  });
  it("pins actor namespace generation in both impact versions even when provider readiness version is fixed", async () => {
    let generation = "e".repeat(64);
    const f = await fixture(r => ({ body: r.path.endsWith("capabilities") ? capabilities() : { ...readiness(), scopeVersion: generation } }));
    f.options.verifyActorScope = async () => ({ ...scope(), scopeVersion: generation });
    const wholeAdapter = createMessagingAccountErasureAdapter(f.options), effectsAdapter = createMessagingMobilityProviderEffects(f.options);
    const wholeBefore = await wholeAdapter.preflight!(actor(), { signal: context().signal });
    const effectsBefore = await effectsAdapter.preflight(actor(), context().signal);
    generation = "d".repeat(64);
    const wholeAfter = await wholeAdapter.preflight!(actor(), { signal: context().signal });
    const effectsAfter = await effectsAdapter.preflight(actor(), context().signal);
    if (!wholeBefore.ready || !wholeAfter.ready || !effectsBefore.ready || !effectsAfter.ready) throw new Error("synthetic namespace readiness failed");
    expect(wholeAfter.version).not.toEqual(wholeBefore.version);
    expect(effectsAfter.version).not.toEqual(effectsBefore.version);
    expect(f.requests.every(r => !r.headers["idempotency-key"] && !r.path.endsWith("owner-v2") && r.path !== "/api/v1/communication/mobility-effects-erasure")).toBe(true);
  });
  it("scope change after source action prevents stale completion and cannot authorize another erase", async () => {
    const f = await fixture(); let calls = 0;
    f.options.verifyActorScope = async () => ++calls === 1 ? scope() : null;
    expect(await createMessagingAccountErasureAdapter(f.options).erase(actor(), context())).toMatchObject({ status: "pending" });
    expect(await createMessagingAccountErasureAdapter(f.options).erase(actor(), context())).toMatchObject({ status: "pending" });
    expect(f.requests).toHaveLength(1);
  });
  it("rejects changed native authority after provider readback rather than returning a stale completion", async () => {
    const f = await fixture(); let calls = 0; f.options.verifyConfiguredOwner = async () => ++calls === 1;
    expect(await createMessagingAccountErasureAdapter(f.options).erase(actor(), context())).toMatchObject({ status: "pending" });
  });
  it("disabled config, invalid origin and invalid operation never fall back to public URLs or v1", async () => {
    const f = await fixture();
    for (const change of [{ enabled: false }, { token: undefined }, { baseUrl: "https://user:password@untrusted.test" }, { baseUrl: "http://127.0.0.1/?actor=other" }]) {
      const options = { ...f.options, config: { ...f.options.config, ...change } };
      expect(await createMessagingAccountErasureAdapter(options).ready()).toBe(false);
      expect(await createMessagingAccountErasureAdapter(options).erase(actor(), context())).toMatchObject({ status: "pending" });
    }
    await expect(createMessagingAccountErasureAdapter(f.options).erase(actor(), { ...context(), operationId: "invalid" })).rejects.toMatchObject({ status: 400 });
    expect(f.requests).toEqual([]);
  });
});

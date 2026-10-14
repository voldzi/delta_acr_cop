import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmDeletion,
  deletionAvailable,
  parseDeletionPreflight,
  parseDeletionReceipt,
  readDeletionReceipt,
  readDeletionIdentity,
  prepareDeletion,
  type DeletionIdentity
} from "./account-deletion-api";

const id = "1a0e80dc-9c45-4988-a6f6-56b7ac9b5c66",
  other = "6a141b4c-a6ca-4d29-9537-fa3b78d6869e";
const issuer = "https://login.example.test/realms/cop";
const config = {
  mode: "oidc" as const,
  issuer,
  clientId: "cop-web",
  scope: "openid profile email",
  publicReadEnabled: true
};
const session = {
  status: "authenticated" as const,
  transport: "bff" as const,
  accessToken: "cop-bff-session",
  profile: { subjectId: "synthetic-a", name: "Cached name", username: "cached" }
};
const identity: DeletionIdentity = {
  issuer,
  subjectId: "synthetic-a",
  displayName: "Canonical A",
  email: "a@example.test",
  emailVerified: true
};
const canonical = {
  contractVersion: "cop-account-profile-v1",
  ...identity,
  avatarDataUrl: null,
  revision: "a".repeat(64),
  updatedAt: null,
  serverTimestamp: "2026-10-14T08:00:00Z"
};
function profileReply(value: unknown = canonical, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...extraHeaders }
  });
}
const pending = {
  contractVersion: "cop-account-erasure-v1",
  deletionScope: "cop_jizda_preserve_shared_identity_sim",
  operationId: id,
  requestedAt: "2026-10-14T08:00:00Z",
  status: "deleting",
  accountDeleted: false,
  revocationEnforced: true,
  remaining: ["ai_router"]
};
const plan = {
  contractVersion: "cop-account-erasure-preflight-v1",
  deletionScope: "cop_jizda_preserve_shared_identity_sim",
  operationId: id,
  canConfirm: true,
  planId: other,
  confirmBy: "2099-10-14T08:05:00Z",
  blockers: []
};
afterEach(() => vi.unstubAllGlobals());
describe("account deletion browser contract boundary", () => {
  it("never presents pending or internally inconsistent receipts as a deleted account", () => {
    expect(parseDeletionReceipt(pending, id, 202)).toMatchObject({ status: "deleting", accountDeleted: false });
    for (const value of [
      { ...pending, accountDeleted: true },
      { ...pending, remaining: [] },
      { ...pending, status: "deleted" },
      { ...pending, operationId: other },
      { ...pending, revocationEnforced: false },
      { ...pending, deletionScope: undefined },
      { ...pending, deletionScope: "shared_identity_deleted" },
      { ...pending, remaining: ["ai_router", "ai_router"] }
    ]) {
      expect(() => parseDeletionReceipt(value, id, 200)).toThrow();
    }
    const complete = {
      ...pending,
      status: "deleted",
      accountDeleted: true,
      remaining: [],
      completedAt: "2026-10-14T08:01:00Z"
    };
    expect(parseDeletionReceipt(complete, id, 200).accountDeleted).toBe(true);
    expect(() => parseDeletionReceipt(complete, id, 202)).toThrow();
  });
  it("rejects another operation or unsupported/contradictory preflight plan", () => {
    expect(parseDeletionPreflight(plan, id).canConfirm).toBe(true);
    for (const value of [
      { ...plan, operationId: other },
      { ...plan, deletionScope: undefined },
      { ...plan, deletionScope: "shared_identity_deleted" },
      { ...plan, planId: undefined },
      { ...plan, canConfirm: false },
      { ...plan, blockers: [{ domain: "unknown", reason: "adapter_unavailable" }] }
    ])
      expect(() => parseDeletionPreflight(value, id)).toThrow();
  });
  it("uses the cookie on same origin and sends neither BFF marker nor browser-selected target", async () => {
    const fetch = vi.fn(async (url: string) =>
      url === "/api/v1/me/profile" ? profileReply() : new Response(JSON.stringify(pending), { status: 202 })
    );
    vi.stubGlobal("fetch", fetch);
    await confirmDeletion(session, { ...parseDeletionPreflight(plan, id), identity }, config);
    const [url, init] = fetch.mock.calls[1]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/me/account-deletion");
    expect(init.credentials).toBe("same-origin");
    expect(init.redirect).toBe("error");
    const headers = new Headers(init.headers);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.get("Idempotency-Key")).toBe(id);
    expect(headers.get("x-cop-erasure-plan")).toBe(other);
    expect(JSON.parse(init.body as string)).toEqual({ confirmAccountDeletion: true });
  });
  it("reads a post-login receipt without bearer, query or capability in script storage", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(pending), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect((await readDeletionReceipt(id)).accountDeleted).toBe(false);
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/me/account-deletion/receipts/" + id);
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    await expect(readDeletionReceipt("../other")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps deletion unavailable on 503 and never issues a confirmation as fallback", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: { code: "ERASURE_UNAVAILABLE" } }), { status: 503 })
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      deletionAvailable({ status: "authenticated", transport: "token", accessToken: "synthetic-only" })
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reads the canonical authenticated identity without cached labels, caching, redirects or identity in the URL", async () => {
    const fetch = vi.fn(async () => profileReply());
    vi.stubGlobal("fetch", fetch);
    expect(await readDeletionIdentity(session, config)).toEqual(identity);
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/me/profile");
    expect(init).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer"
    });
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(init.body).toBeUndefined();
  });
  it("rejects another subject or issuer, an unavailable subject and cached or malformed canonical data", async () => {
    const fetch = vi.fn(async () => profileReply({ ...canonical, subjectId: "synthetic-b" }));
    vi.stubGlobal("fetch", fetch);
    await expect(readDeletionIdentity(session, config)).rejects.toMatchObject({ code: "ACCOUNT_IDENTITY_CHANGED" });
    fetch.mockImplementation(async () =>
      profileReply({ ...canonical, issuer: "https://other.example.test/realms/cop" })
    );
    await expect(readDeletionIdentity(session, config)).rejects.toMatchObject({ code: "ACCOUNT_IDENTITY_CHANGED" });
    await expect(readDeletionIdentity({ ...session, profile: undefined }, config)).rejects.toMatchObject({
      code: "ACCOUNT_IDENTITY_UNAVAILABLE"
    });
    for (const value of [
      { ...canonical, contractVersion: "other" },
      { ...canonical, emailVerified: "true" },
      { ...canonical, subjectId: "a\u0080b" },
      { ...canonical, subjectId: "a".repeat(513) },
      { ...canonical, revision: "not-a-revision" },
      { ...canonical, serverTimestamp: "invalid" },
      { ...canonical, leaked: "private" }
    ]) {
      fetch.mockImplementation(async () => profileReply(value));
      await expect(readDeletionIdentity(session, config)).rejects.toMatchObject({ code: "INVALID_REPLY" });
    }
    fetch.mockImplementation(async () => profileReply(canonical, { "Cache-Control": "private, max-age=60" }));
    await expect(readDeletionIdentity(session, config)).rejects.toMatchObject({ code: "INVALID_REPLY" });
  });
  it("binds preparation to the displayed identity and rejects a cookie change during preflight", async () => {
    let reads = 0;
    const fetch = vi.fn(async (url: string) =>
      url === "/api/v1/me/profile"
        ? profileReply(++reads === 1 ? canonical : { ...canonical, subjectId: "synthetic-b" })
        : new Response(JSON.stringify(plan), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);
    await expect(prepareDeletion(session, id, identity, config)).rejects.toMatchObject({
      code: "ACCOUNT_IDENTITY_CHANGED"
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/me/profile",
      "/api/v1/me/account-deletion/preflight",
      "/api/v1/me/profile"
    ]);
    expect(fetch.mock.calls.some(([url]) => url === "/api/v1/me/account-deletion")).toBe(false);
  });
  it("does not submit or persist an operation when the displayed account changes before confirmation", async () => {
    const fetch = vi.fn(async () => profileReply({ ...canonical, subjectId: "synthetic-b" }));
    const submit = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      confirmDeletion(session, { ...parseDeletionPreflight(plan, id), identity }, config, submit)
    ).rejects.toMatchObject({ code: "ACCOUNT_IDENTITY_CHANGED" });
    expect(submit).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/v1/me/profile", expect.any(Object));
    fetch.mockImplementation(async () => profileReply({ ...canonical, email: "changed@example.test" }));
    await expect(
      confirmDeletion(session, { ...parseDeletionPreflight(plan, id), identity }, config, submit)
    ).rejects.toMatchObject({ code: "ACCOUNT_IDENTITY_CHANGED" });
    expect(submit).not.toHaveBeenCalled();
  });
  it("bounds successful profile and error bodies and never copies untrusted error text into errors", async () => {
    const fetch = vi.fn(async () => profileReply({ ...canonical, avatarDataUrl: "x".repeat(320_001) }));
    vi.stubGlobal("fetch", fetch);
    await expect(readDeletionIdentity(session, config)).rejects.toMatchObject({ code: "INVALID_REPLY" });
    fetch.mockImplementation(
      async () => new Response(JSON.stringify({ error: { code: "secret text a@example.test" } }), { status: 503 })
    );
    await expect(readDeletionIdentity(session, config)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    fetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: "PROFILE_UNAVAILABLE", text: "x".repeat(16_384) } }), {
          status: 503
        })
    );
    await expect(readDeletionIdentity(session, config)).rejects.toMatchObject({ code: "INVALID_REPLY" });
  });
});

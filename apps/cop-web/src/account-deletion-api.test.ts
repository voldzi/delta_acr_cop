import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmDeletion,
  deletionAvailable,
  parseDeletionPreflight,
  parseDeletionReceipt,
  readDeletionReceipt
} from "./account-deletion-api";

const id = "1a0e80dc-9c45-4988-a6f6-56b7ac9b5c66",
  other = "6a141b4c-a6ca-4d29-9537-fa3b78d6869e";
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
    const fetch = vi.fn(async () => new Response(JSON.stringify(pending), { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    await confirmDeletion(
      { status: "authenticated", transport: "bff", accessToken: "cop-bff-session" },
      parseDeletionPreflight(plan, id)
    );
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
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
});

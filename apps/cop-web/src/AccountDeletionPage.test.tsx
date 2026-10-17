// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountDeletionPage from "./AccountDeletionPage";
import type { AuthSession } from "./auth";

const auth = vi.hoisted(() => ({
  initialize: vi.fn(),
  forget: vi.fn(),
  login: vi.fn(),
  config: {
    mode: "oidc",
    issuer: "https://login.example.test/realms/cop",
    clientId: "cop-web",
    scope: "openid profile email",
    publicReadEnabled: true
  }
}));
vi.mock("./auth", () => ({
  initializeAuth: auth.initialize,
  forgetLocalAuthSession: auth.forget,
  beginLogin: auth.login,
  readAuthConfig: () => auth.config
}));
const operationId = "1a0e80dc-9c45-4988-a6f6-56b7ac9b5c66";
const planId = "6a141b4c-a6ca-4d29-9537-fa3b78d6869e";
const scope = "cop_sim_shared_identity_v1";
const profile = (subjectId = "synthetic-a", email: string | null = "a@example.test") => ({
  contractVersion: "cop-account-profile-v1",
  subjectId,
  issuer: auth.config.issuer,
  displayName: "Stejné jméno",
  email,
  emailVerified: email !== null,
  avatarDataUrl: null,
  revision: "a".repeat(64),
  updatedAt: null,
  serverTimestamp: "2026-10-14T08:00:00Z"
});
function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function session(subjectId = "synthetic-a"): AuthSession {
  return {
    status: "authenticated",
    transport: "bff",
    accessToken: "cop-bff-session",
    profile: { subjectId, name: "Starý uložený název", username: "cached", email: "cached@example.test" }
  };
}
function transport(current: () => ReturnType<typeof profile>, onPreflight?: () => void) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/me/profile") return reply(current());
    if (url.endsWith("/capabilities"))
      return reply({ contractVersion: "cop-account-erasure-v2", accountDeletion: true });
    if (url.endsWith("/preflight")) {
      onPreflight?.();
      return reply({
        contractVersion: "cop-account-erasure-preflight-v2",
        deletionScope: scope,
        operationId: new Headers(init?.headers).get("Idempotency-Key"),
        canConfirm: true,
        planId,
        confirmBy: "2099-10-14T08:05:00Z",
        blockers: []
      });
    }
    if (url === "/api/v1/me/account-deletion" || url.includes("/receipts/")) {
      return reply(
        {
          contractVersion: "cop-account-erasure-v2",
          deletionScope: scope,
          operationId: operationId,
          requestedAt: "2026-10-14T08:00:00Z",
          revocationEnforced: true,
          status: "deleting",
          accountDeleted: false,
          remaining: ["ai_router"]
        },
        url.includes("/receipts/") ? 200 : 202
      );
    }
    throw new Error("Unexpected synthetic request");
  });
}
beforeEach(() => {
  auth.initialize.mockReset();
  auth.forget.mockReset();
  auth.login.mockReset();
  sessionStorage.clear();
  localStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("account erasure displays and binds the real web account", () => {
  it.each([
    ["synthetic-a", "a@example.test"],
    ["synthetic-b", "b@example.test"]
  ])("shows canonical %s even when cached names are equal or stale", async (subjectId, email) => {
    auth.initialize.mockResolvedValue(session(subjectId));
    const fetch = transport(() => profile(subjectId, email));
    vi.stubGlobal("fetch", fetch);
    render(<AccountDeletionPage />);
    await screen.findByRole("button", { name: "Zkontrolovat podmínky odstranění" });
    const account = screen.getByLabelText("Ověřený webový účet");
    expect(account.textContent).toContain("Stejné jméno");
    expect(account.textContent).toContain(email);
    expect(account.textContent).not.toContain("Starý uložený název");
    expect(account.textContent).not.toContain("cached@example.test");
    expect(account.textContent).toContain("tohoto webového účtu");
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/me/profile",
      "/api/v1/me/account-deletion/capabilities"
    ]);
  });
  it.each(["synthetic-a", "synthetic-b"])(
    "keeps %s distinguishable when both the name and unverified email are shared",
    async (subjectId) => {
      auth.initialize.mockResolvedValue(session(subjectId));
      vi.stubGlobal(
        "fetch",
        transport(() => ({ ...profile(subjectId, "shared@example.test"), emailVerified: false }))
      );
      render(<AccountDeletionPage />);
      await screen.findByRole("button", { name: "Zkontrolovat podmínky odstranění" });
      const account = screen.getByLabelText("Ověřený webový účet");
      expect(account.textContent).toContain("Stejné jméno");
      expect(account.textContent).toContain("E-mail (neověřený): shared@example.test");
      const details = account.querySelector("details");
      expect(details?.querySelector("summary")?.textContent).toBe("Rozlišovací ID účtu");
      expect(details?.querySelector("p")?.textContent).toBe(subjectId);
      expect(sessionStorage.length).toBe(0);
      expect(localStorage.length).toBe(0);
    }
  );
  it("shows the exact account ID when no email is available", async () => {
    auth.initialize.mockResolvedValue(session());
    vi.stubGlobal(
      "fetch",
      transport(() => profile("synthetic-a", null))
    );
    render(<AccountDeletionPage />);
    await screen.findByRole("button", { name: "Zkontrolovat podmínky odstranění" });
    expect(screen.getByLabelText("Ověřený webový účet").textContent).toContain("ID účtu: synthetic-a");
  });
  it.each(["subject", "issuer"])(
    "does not offer preparation when canonical %s differs from session/config",
    async (field) => {
      auth.initialize.mockResolvedValue(session());
      const fetch = transport(() =>
        field === "subject"
          ? profile("synthetic-b", "b@example.test")
          : { ...profile(), issuer: "https://other.example.test/realms/cop" }
      );
      vi.stubGlobal("fetch", fetch);
      render(<AccountDeletionPage />);
      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: "Zkontrolovat podmínky odstranění" })).toBeNull();
      expect(screen.queryByLabelText("Ověřený webový účet")).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sessionStorage.length).toBe(0);
    }
  );
  it("discards a preflight if the cookie actor changes while the plan is prepared", async () => {
    auth.initialize.mockResolvedValue(session());
    let current = profile();
    const fetch = transport(
      () => current,
      () => {
        current = profile("synthetic-b", "b@example.test");
      }
    );
    vi.stubGlobal("fetch", fetch);
    render(<AccountDeletionPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Zkontrolovat podmínky odstranění" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("Ověřený webový účet")).toBeNull();
    expect(fetch.mock.calls.some(([url]) => url === "/api/v1/me/account-deletion")).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });
  it.each(["subject", "email"])(
    "rechecks changed %s before confirming and does not enter lost-response recovery",
    async (field) => {
      auth.initialize.mockResolvedValue(session());
      let current = profile();
      const fetch = transport(() => current);
      vi.stubGlobal("fetch", fetch);
      const persist = vi.spyOn(Storage.prototype, "setItem");
      render(<AccountDeletionPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Zkontrolovat podmínky odstranění" }));
      fireEvent.click(await screen.findByRole("checkbox"));
      expect(screen.getByRole("checkbox").parentElement?.textContent).toContain("a@example.test");
      current =
        field === "subject" ? profile("synthetic-b", "b@example.test") : profile("synthetic-a", "changed@example.test");
      fireEvent.click(screen.getByRole("button", { name: "Trvale odstranit celý účet" }));
      await screen.findByRole("alert");
      expect(screen.getByRole("alert").textContent).toContain("Nic jsme nepotvrdili");
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(
        fetch.mock.calls.some(([url]) => url === "/api/v1/me/account-deletion" || url.includes("/receipts/"))
      ).toBe(false);
      expect(persist).not.toHaveBeenCalled();
      expect(auth.forget).not.toHaveBeenCalled();
    }
  );
  it("stores only the operation UUID after the matching canonical identity is rechecked", async () => {
    auth.initialize.mockResolvedValue(session());
    const fetch = transport(() => profile());
    vi.stubGlobal("fetch", fetch);
    const persist = vi.spyOn(Storage.prototype, "setItem");
    render(<AccountDeletionPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Zkontrolovat podmínky odstranění" }));
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Trvale odstranit celý účet" }));
    await screen.findByRole("heading", { name: "Odstranění probíhá" });
    await waitFor(() => expect(auth.forget).toHaveBeenCalled());
    expect(persist.mock.calls).toEqual([["cop-account-erasure-operation-v1", operationId]]);
    expect(localStorage.length).toBe(0);
    const calls = fetch.mock.calls as [string, RequestInit | undefined][];
    expect(calls.filter(([url]) => url === "/api/v1/me/profile")).toHaveLength(4);
    const post = calls.find(([url]) => url === "/api/v1/me/account-deletion");
    expect(JSON.parse(post![1]!.body as string)).toEqual({ confirmAccountDeletion: true });
    for (const [url, init] of calls) {
      expect(url).not.toMatch(/synthetic-|example\.test|\?|#/u);
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    }
    expect(window.location.href).not.toContain(operationId);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })), end: vi.fn(async () => undefined), on: vi.fn(), create: vi.fn() }));
vi.mock("./cop-pg-pool.js", () => ({ createCopPgPool: fake.create }));
import { accountSafetyGuardStoreFromEnv, mobilityStoreFromEnv } from "./mobility-store.js";
afterEach(() => vi.clearAllMocks());
describe("independent persistent safety guard store factory", () => {
  it("loads a registered single-connection guard with mobility off and no Dispatch lease", async () => {
    fake.create.mockReturnValue(fake);
    const env = { COP_DATABASE_URL: "postgres://synthetic.invalid/cop", COP_SHARED_MOBILITY_ENABLED: "false", COP_DATABASE_SSL: "false" };
    expect(mobilityStoreFromEnv(env)).toBeUndefined();
    const guard = accountSafetyGuardStoreFromEnv(env)!;
    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(fake.create).toHaveBeenCalledWith("mobility", expect.objectContaining({ max: 1, connectionString: env.COP_DATABASE_URL }));
    expect(guard.dispatchIsAvailable()).toBe(false);
    await expect(guard.claimDispatchInstance()).rejects.toThrow("Guard-only store cannot dispatch");
    await guard.close(); expect(fake.end).toHaveBeenCalledTimes(1);
  });
  it("does not invent a RAM store or silently change invalid TLS configuration", () => {
    expect(accountSafetyGuardStoreFromEnv({ COP_SHARED_MOBILITY_ENABLED: "false" })).toBeUndefined();
    expect(() => accountSafetyGuardStoreFromEnv({ COP_DATABASE_URL: "synthetic", COP_DATABASE_SSL: "invalid" })).toThrow("Unsupported PostgreSQL TLS");
    expect(fake.create).not.toHaveBeenCalled();
  });
});

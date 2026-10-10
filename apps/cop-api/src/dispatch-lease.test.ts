import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { DispatchLease } from "./dispatch-lease.js";

class Connection extends EventEmitter {
  owned = true;
  primary = true;
  releases = 0;
  async query(sql: string) { return { rows: [sql.includes("AS acquired") ? { acquired: this.owned && this.primary } : { owned: this.owned && this.primary }] }; }
  release() { this.releases++; }
}
class Connections {
  items: Connection[] = [];
  fail = false;
  async connect() { if (this.fail) throw Error("synthetic unavailable"); const item = new Connection(); this.items.push(item); return item as unknown as PoolClient; }
  async end() {}
}
const timing = { heartbeatMs: 20, retryMinMs: 10, retryMaxMs: 30, maxVerificationAgeMs: 100 };
describe("Dispatch exclusive lease recovery", () => {
  it("recovers repeated disconnects only after invalidation and never has overlapping owners", async () => {
    const pool = new Connections(); const lease = new DispatchLease(pool as unknown as Pool, timing);
    let acquired = 0; const lost = vi.fn();
    const hooks = { lost, acquired: async () => { expect(lease.available()).toBe(false); acquired++; } };
    await lease.start(hooks);
    try {
      expect(lease.available()).toBe(true);
      for (let n = 0; n < 3; n++) {
        const old = pool.items.at(-1)!; const generation = lease.generation();
        old.emit("error", Error("synthetic closed"));
        expect(lease.available()).toBe(false);
        expect(lease.generation()).toBeGreaterThan(generation);
        await vi.waitFor(() => expect(lease.available()).toBe(true));
        expect(old.releases).toBe(1);
        // Late events on retired connections cannot invalidate the new owner.
        old.emit("end"); expect(lease.available()).toBe(true);
      }
      expect(lost).toHaveBeenCalledTimes(3); expect(acquired).toBe(4);
    } finally { await lease.close(); }
  });
  it("blocks readiness during invalidation and after heartbeat detects missing ownership", async () => {
    const pool = new Connections(); const lease = new DispatchLease(pool as unknown as Pool, timing);
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const start = lease.start({ lost: () => undefined, acquired: () => barrier });
    await vi.waitFor(() => expect(pool.items.length).toBe(1));
    expect(lease.state()).toBe("recovering"); expect(lease.available()).toBe(false);
    release(); await start; expect(lease.available()).toBe(true);
    pool.fail = true; pool.items[0]!.owned = false;
    try { await vi.waitFor(() => expect(lease.available()).toBe(false)); expect(lease.state()).toBe("unavailable"); }
    finally { await lease.close(); }
  });
  it("preserves fail-closed state on outage, rejects a secondary and cancels recovery on shutdown", async () => {
    const pool = new Connections(); pool.fail = true;
    const lease = new DispatchLease(pool as unknown as Pool, timing);
    let initializations = 0;
    await lease.start({ lost: () => undefined, acquired: async () => { initializations++; } });
    expect(lease.available()).toBe(false);
    pool.fail = false;
    await vi.waitFor(() => expect(lease.available()).toBe(true));
    expect(initializations).toBe(1);
    pool.fail = true; pool.items.at(-1)!.primary = false;
    await vi.waitFor(() => expect(lease.available()).toBe(false));
    await lease.close(); pool.fail = false;
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(initializations).toBe(1); expect(lease.available()).toBe(false);
  });
});

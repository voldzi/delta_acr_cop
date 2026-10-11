import type { Pool, PoolClient } from "pg";

export type DispatchLeaseState = "ready" | "recovering" | "unavailable";
export type DispatchLeaseHooks = {
  lost: () => void;
  acquired: () => Promise<void>;
  changed?: (state: DispatchLeaseState, generation: number) => void;
};
type Timing = { heartbeatMs: number; retryMinMs: number; retryMaxMs: number; maxVerificationAgeMs: number };

/** Dedicated session connection, one recovery flight, no credentials in diagnostics. */
export class DispatchLease {
  private connection?: PoolClient;
  private releaseConnection?: () => void;
  private timer?: NodeJS.Timeout;
  private flight?: Promise<void>;
  private hooks?: DispatchLeaseHooks;
  private closed = false;
  private failures = 0;
  private verifiedAt = 0;
  private revision = 0;
  private status: DispatchLeaseState = "unavailable";
  private readonly timing: Timing;
  constructor(private readonly pool: Pick<Pool, "connect" | "end">, timing: Partial<Timing> = {}) {
    this.timing = { heartbeatMs: 5000, retryMinMs: 500, retryMaxMs: 10000, maxVerificationAgeMs: 15000, ...timing };
  }
  state(): DispatchLeaseState { return this.status === "ready" && !this.available() ? "unavailable" : this.status; }
  generation(): number { return this.revision; }
  available(): boolean {
    return !this.closed && this.status === "ready" && !!this.connection && Date.now() - this.verifiedAt <= this.timing.maxVerificationAgeMs;
  }
  private change(state: DispatchLeaseState): void {
    if (this.status === state) return;
    this.status = state;
    this.hooks?.changed?.(state, this.revision);
  }
  private lose(): void {
    if (!this.connection) return;
    this.revision++;
    this.connection = undefined;
    const release = this.releaseConnection; this.releaseConnection = undefined;
    this.verifiedAt = 0;
    this.change("unavailable");
    this.hooks?.lost();
    release?.();
    if (this.hooks && !this.closed) this.schedule();
  }
  /** One-shot claim retained for isolated exclusive-owner tests. */
  async claim(acquired: () => Promise<void> = async () => undefined): Promise<void> {
    if (this.closed) throw new Error("Dispatch lease is closed.");
    if (this.connection) throw new Error("Dispatch lease is already held.");
    this.change("recovering");
    const generation = ++this.revision;
    const connection = await this.pool.connect();
    if (this.closed || generation !== this.revision) { connection.release(true); throw new Error("Dispatch lease acquisition superseded."); }
    this.connection = connection;
    let released = false;
    this.releaseConnection = () => { if (!released) { released = true; connection.release(true); } };
    const lost = () => { if (this.connection === connection) this.lose(); };
    connection.on("error", lost); connection.on("end", lost);
    try {
      const result = await connection.query<{ acquired: boolean }>("SELECT CASE WHEN pg_is_in_recovery() THEN false ELSE pg_try_advisory_lock(731031,1) END AS acquired");
      if (!result.rows[0]?.acquired) throw new Error("Private Dispatch supports one active API instance on the primary.");
      await acquired();
      if (!await this.verify(connection, generation)) throw new Error("Dispatch lease was lost during initialization.");
      this.failures = 0;
      this.change("ready");
    } catch (error) { if (this.connection === connection) this.lose(); throw error; }
  }
  private async verify(connection: PoolClient, generation: number): Promise<boolean> {
    const result = await connection.query<{ owned: boolean }>("SELECT NOT pg_is_in_recovery() AND EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=731031 AND objid=1 AND pid=pg_backend_pid() AND granted) AS owned");
    if (this.closed || this.connection !== connection || this.revision !== generation || !result.rows[0]?.owned) return false;
    this.verifiedAt = Date.now(); return true;
  }
  async start(hooks: DispatchLeaseHooks): Promise<void> {
    if (this.hooks) throw new Error("Dispatch recovery is already started.");
    this.hooks = hooks;
    await this.cycle();
  }
  private schedule(): void {
    if (this.closed || !this.hooks) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = this.available() ? this.timing.heartbeatMs : Math.min(this.timing.retryMaxMs, this.timing.retryMinMs * 2 ** Math.min(this.failures, 5));
    // Small jitter avoids synchronized reconnects across unavailable contenders.
    this.timer = setTimeout(() => { this.timer = undefined; void this.cycle(); }, delay + Math.floor(Math.random() * delay * 0.1));
    this.timer.unref();
  }
  private async cycle(): Promise<void> {
    if (this.closed) return;
    if (this.flight) return this.flight;
    const flight = this.runCycle(); this.flight = flight;
    try { await flight; } finally { if (this.flight === flight) this.flight = undefined; this.schedule(); }
  }
  private async runCycle(): Promise<void> {
    try {
      if (this.connection) {
        const connection = this.connection;
        if (await this.verify(connection, this.revision)) return;
        this.lose();
      }
      if (!this.closed) await this.claim(this.hooks!.acquired);
    } catch {
      // Errors are deliberately reduced to a state, never raw DB/DSN diagnostics.
      this.failures++;
      this.lose();
      this.change("unavailable");
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.lose(); this.change("unavailable");
    await this.flight?.catch(() => undefined);
    await this.pool.end();
  }
}

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { ProjectionEraseContext, ProjectionFenceSnapshot, ProjectionResources, ProjectionStateOwner } from "./resource-projection-erasure.js";
import { projectionReferences } from "./resource-projection-erasure.js";
import { requireRuntimeOwner, runtimeAssessment, runtimeOwnerHash, runtimeSubjectHash, type RuntimeOwner } from "./runtime-owner-erasure.js";

const context = new AsyncLocalStorage<{ boundary: ProviderCopiesBoundary; generation: number }>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const kinds = new Set(["communityReport", "communityGroup", "incident", "task", "sketchDrawing"]);
export class ProviderCopiesUnavailableError extends Error {
  readonly status = 503;
  readonly code = "PROVIDER_COPY_ERASURE_PENDING";
  constructor() { super("Provider copies are awaiting verified cleanup."); }
}
interface Guard {
  ready(): boolean;
  /** Only a deny check for a possible reference, never origin/ownership proof. */
  assertPossibleSubjectAllowed(subject: string): void;
}
class ProviderCopyFence {
  private loaded = false;
  private readonly resourceIds = new Set<string>();
  private readonly subjects = new Set<string>();
  constructor(private readonly guard: Guard) {}
  ready(): boolean { return this.loaded && this.guard.ready(); }
  hydrate(snapshot: ProjectionFenceSnapshot): void {
    if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(snapshot.version) || snapshot.resources.length + snapshot.subjectHashes.length + snapshot.ownerHashes.length > 100000) throw new ProviderCopiesUnavailableError();
    for (const ref of snapshot.resources) { if (!kinds.has(ref.kind) || !uuid.test(ref.id)) throw new ProviderCopiesUnavailableError(); this.resourceIds.add(ref.id.toLowerCase()); }
    for (const value of [...snapshot.subjectHashes, ...snapshot.ownerHashes]) if (!/^[a-f0-9]{64}$/u.test(value)) throw new ProviderCopiesUnavailableError();
    for (const value of snapshot.subjectHashes) this.subjects.add(value);
    this.loaded = true;
  }
  fence(owner: RuntimeOwner, resources: ProjectionResources): void {
    requireRuntimeOwner(owner); this.subjects.add(runtimeSubjectHash(owner.subjectId));
    for (const ref of projectionReferences(resources)) this.resourceIds.add(ref.id);
  }
  blocked(value: unknown): boolean {
    if (!this.ready()) throw new ProviderCopiesUnavailableError();
    const seen = new Set<object>(), strings = new Set<string>(); let visited = 0;
    const visit = (value: unknown, depth: number): boolean => {
      if (++visited > 8_000_000 || depth > 100) throw new ProviderCopiesUnavailableError();
      if (typeof value === "string") {
        if (strings.has(value)) return false; strings.add(value);
        const candidates = [value, ...(value.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/giu) ?? [])];
        for (const candidate of candidates) {
          if (uuid.test(candidate) && this.resourceIds.has(candidate.toLowerCase()) || this.subjects.has(runtimeSubjectHash(candidate))) return true;
          if (candidate && Buffer.byteLength(candidate) <= 512) {
            try { this.guard.assertPossibleSubjectAllowed(candidate); }
            catch (error) {
              const code = error && typeof error === "object" && "code" in error ? error.code : error instanceof Error ? error.message : undefined;
              if (code === "ACCOUNT_ERASURE_FENCED" || code === "ACCOUNT_REVOKED") return true;
              throw new ProviderCopiesUnavailableError();
            }
          }
        }
        return false;
      }
      if (!value || typeof value !== "object" || value instanceof Date) return false;
      if (seen.has(value)) throw new ProviderCopiesUnavailableError();
      seen.add(value); const result = Object.values(value).some(child => visit(child, depth + 1)); seen.delete(value); return result;
    };
    return visit(value, 0);
  }
}
function copied<T>(value: T, freeze: boolean): T {
  if (value === undefined) return value;
  const clone = JSON.parse(JSON.stringify(value)) as T;
  if (freeze) {
    const deep = (value: unknown): void => { if (value && typeof value === "object") { for (const child of Object.values(value)) deep(child); Object.freeze(value); } };
    deep(clone);
  }
  return clone;
}

/** Concrete reconstructible cache boundary. The callbacks read/clear the real
 * private cache fields; this cannot acknowledge remote SIM/TAK deletion. */
export class ProviderCopiesBoundary {
  private guard?: ProviderCopyFence;
  private generation = 0;
  private bindingGeneration = 0;
  private readonly calls = new Set<{ generation: number }>();
  private readonly fetches = new Set<{ generation: number; controller?: AbortController; settlementFailed?: boolean }>();
  private readonly operations = new Map<string, number>();
  private readonly wrappers = new Map<string, unknown>();
  private readonly known: boolean;
  constructor(private readonly options: {
    family: string;
    target: object;
    prototype: object;
    methods: readonly string[];
    caches: { clear(): void; values(): unknown[]; inflight(): number };
  }) {
    const target = options.target as Record<string, unknown>;
    this.known = Object.getPrototypeOf(target) === options.prototype && options.methods.length > 0 && options.methods.every(method => typeof target[method] === "function");
    if (!this.known) return;
    for (const method of options.methods) {
      const original = (target[method] as (...args: unknown[]) => Promise<unknown>).bind(target);
      const wrapper = (...args: unknown[]) => this.run(args, () => original(...args));
      Object.defineProperty(target, method, { value: wrapper, configurable: false }); this.wrappers.set(method, wrapper);
    }
  }
  bind(guard: ProviderCopyFence): boolean {
    if (!this.installed() || this.guard && this.guard !== guard) return false;
    if (!this.guard) { this.guard = guard; this.bindingGeneration = ++this.generation; this.options.caches.clear(); }
    return true;
  }
  matches(guard: ProviderCopyFence): boolean { return this.guard === guard && this.installed(); }
  owns(source: object): boolean { return this.options.target === source; }
  installed(): boolean {
    return this.known && [...this.wrappers].every(([name, wrapper]) => (this.options.target as Record<string, unknown>)[name] === wrapper);
  }
  private current(generation: number): void {
    if (this.guard && (!this.guard.ready() || generation !== this.generation)) throw new ProviderCopiesUnavailableError();
  }
  private async run<T>(args: unknown[], run: () => Promise<T>): Promise<T> {
    const generation = this.generation; this.current(generation);
    if (this.guard?.blocked(args)) throw new ProviderCopiesUnavailableError();
    const call = { generation }; this.calls.add(call);
    try {
      return await context.run({ boundary: this, generation }, async () => {
        const value = await run(); this.current(generation);
        if (this.guard?.blocked(value)) throw new ProviderCopiesUnavailableError();
        return this.guard ? copied(value, false) : value;
      });
    } finally { this.calls.delete(call); }
  }
  prepare<T>(value: T, generation: number): T {
    this.current(generation);
    if (this.guard?.blocked(value)) throw new ProviderCopiesUnavailableError();
    return this.guard ? copied(value, true) : value;
  }
  async track<T>(start: () => Promise<T>, generation: number, controller?: AbortController): Promise<T> {
    this.current(generation); const fetch = { generation, ...(controller ? { controller } : {}) }; this.fetches.add(fetch);
    try { const value = await start(); this.current(generation); if (this.guard?.blocked(value)) throw new ProviderCopiesUnavailableError(); return value; }
    finally { this.fetches.delete(fetch); }
  }
  async settlement<T>(start: () => Promise<T>, generation: number): Promise<T> {
    if (!this.guard) return start();
    const lease: { generation: number; settlementFailed?: boolean } = { generation }; this.fetches.add(lease);
    // A rejected/unknown cancellation remains pending. Calling cancel(), or
    // losing a request deadline, is not affirmative body-settlement evidence.
    try { const value = await start(); this.fetches.delete(lease); return value; }
    catch (error) { lease.settlementFailed = true; throw error; }
  }
  ready(): boolean {
    if (!this.guard?.ready() || !this.installed()) return false;
    if ([...this.fetches].some(value => value.settlementFailed)) return false;
    if ([...this.calls, ...this.fetches].some(value => value.generation < this.bindingGeneration)) return false;
    try {
      if (this.options.caches.values().some(value => this.guard!.blocked(value))) this.options.caches.clear();
      return !this.options.caches.values().some(value => this.guard!.blocked(value));
    } catch { return false; }
  }
  preflight(owner: RuntimeOwner) {
    requireRuntimeOwner(owner);
    // All local copies are reconstructible and actually cleared. A matching
    // raw JSON field is never labeled as this actor's authored resource.
    return { ...runtimeAssessment([this.options.family, "all-local-reconstructible-copies-v1"]), ready: this.ready() };
  }
  erase(resources: ProjectionResources, erasure: ProjectionEraseContext): boolean {
    erasure.signal.throwIfAborted(); if (!erasure.actor || !this.guard?.ready() || !this.installed()) return false;
    this.guard.fence(erasure.actor, resources);
    const op = createHash("sha256").update(JSON.stringify([erasure.operationId, runtimeOwnerHash(erasure.actor)])).digest("hex");
    let barrier = this.operations.get(op);
    if (barrier === undefined) {
      barrier = ++this.generation; this.operations.set(op, barrier); this.options.caches.clear();
      for (const fetch of this.fetches) if (fetch.generation < barrier) fetch.controller?.abort(new ProviderCopiesUnavailableError());
    }
    if (!this.ready()) return false;
    // Governed new-generation calls cannot refill a target reference; don't
    // starve cleanup on unrelated ongoing public map requests after the barrier.
    const old = [...this.calls, ...this.fetches].some(value => value.generation < this.generation);
    erasure.signal.throwIfAborted(); return !old;
  }
  diagnostics(): { cacheCopies: number; activeCalls: number; activeFetches: number; cacheInflight: number } {
    return { cacheCopies: this.options.caches.values().length, activeCalls: this.calls.size, activeFetches: this.fetches.size, cacheInflight: this.options.caches.inflight() };
  }
}
export interface ProviderLocalCopiesSource { providerCopiesBoundary?(): ProviderCopiesBoundary }
export interface ProviderCopiesOwner extends ProjectionStateOwner { init(): Promise<void>; producerBindingInstalled(): boolean }
export function createProviderCopiesErasure(options: {
  sources: readonly ProviderLocalCopiesSource[];
  /** Exact server-owned issuer; possible source references cannot select it. */
  issuer: string;
  cachedGuard: { ready(): boolean; assertActorAllowed(owner: RuntimeOwner): void };
  loadFences(): Promise<ProjectionFenceSnapshot>;
}): ProviderCopiesOwner {
  if (!options.issuer) throw new ProviderCopiesUnavailableError();
  const guard = new ProviderCopyFence({ ready: () => options.cachedGuard.ready(),
    assertPossibleSubjectAllowed: subject => options.cachedGuard.assertActorAllowed({ issuer: options.issuer, subjectId: subject }) });
  const sources = [...new Set(options.sources)], boundaries = sources.map(source => source.providerCopiesBoundary?.());
  const installed = boundaries.every((boundary, index) => boundary?.owns(sources[index]!) && boundary.bind(guard));
  const bound = () => installed && boundaries.every(boundary => boundary?.matches(guard));
  let initialization: Promise<void> | undefined;
  const port: ProviderCopiesOwner = {
    producerBindingInstalled: bound,
    async init() {
      if (!bound()) throw new ProviderCopiesUnavailableError();
      initialization ??= options.loadFences().then(value => guard.hydrate(value)).catch(error => { initialization = undefined; throw error; });
      await initialization;
    },
    async ready() { try { await port.init(); return bound() && guard.ready() && boundaries.every(boundary => boundary!.ready()); } catch { return false; } },
    async preflight(owner) {
      requireRuntimeOwner(owner);
      if (!await port.ready()) return { ...runtimeAssessment(["provider-copies-unavailable"]), ready: false };
      const results = boundaries.map(boundary => boundary!.preflight(owner));
      return { ...runtimeAssessment(results.map(value => value.version)), ready: results.every(value => value.ready) };
    },
    async erase(resources, erasure) {
      erasure.signal.throwIfAborted(); if (!erasure.actor || !bound()) return false;
      await port.init();
      const results = boundaries.map(boundary => boundary!.erase(resources, erasure));
      erasure.signal.throwIfAborted(); return results.every(Boolean);
    }
  };
  return port;
}
/** Keeps an actual transport/body promise tracked even when a caller's deadline
 * wins Promise.race. No model/network call is added by this helper. */
export function trackProviderCopyFetch<T>(start: () => Promise<T>, controller?: AbortController): Promise<T> {
  const current = context.getStore(); return current ? current.boundary.track(start, current.generation, controller) : start();
}
export function prepareProviderCacheCopy<T>(value: T): T {
  const current = context.getStore(); return current ? current.boundary.prepare(value, current.generation) : value;
}
/** Capture while installing an abort listener; the abort may be dispatched
 * from the erasure worker's different AsyncLocalStorage context. */
export function providerCopyCancellationTracker(): <T>(start: () => Promise<T>) => Promise<T> {
  const current = context.getStore();
  return start => current ? current.boundary.settlement(start, current.generation) : start();
}

import { AsyncLocalStorage } from "node:async_hooks";
import type { CopState } from "./types.js";
import { boundedProjectionJSON, canonicalProjectionReference, projectionPayloadMatch, projectionReferences,
  type ProjectionEraseContext, type ProjectionFenceSnapshot, type ProjectionReference, type ProjectionResources, type ProjectionStateOwner } from "./resource-projection-erasure.js";
import { requireRuntimeOwner, runtimeAssessment, runtimeOwnerHash, runtimeSubjectHash, type RuntimeOwner, type RuntimeOwnerAssessment } from "./runtime-owner-erasure.js";
import { readObjectProvenance } from "./provenance.js";
import type { ObservedObject } from "@cop/canonical-model";
import { ContentErasureStoreError } from "./content-erasure.js";

type Field = keyof CopState;
const fields: readonly Field[] = ["sources", "events", "objects", "trackHistory", "idempotency", "alertAcknowledgements", "auditEvents", "federatedNodes", "domainEvents", "domainDeadLetters"];
const arrayFields = new Set<Field>(["auditEvents", "domainEvents", "domainDeadLetters"]);
const uuidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/giu;
const actorContext = new AsyncLocalStorage<{ owner: RuntimeOwner; explicit: boolean }>();
const installed = new WeakMap<CopState, CopStateProjectionOwner>();
export function getCopStateProjectionOwner(state: CopState): CopStateProjectionOwner | undefined { return installed.get(state); }

/** Use only after server verification of the actor; never pass body-selected identity. */
export function runWithProjectionActor<T>(owner: RuntimeOwner, run: () => T): T {
  requireRuntimeOwner(owner); return actorContext.run({ owner: { ...owner }, explicit: false }, run);
}
/** Actual authoritative writer, after ownership validation; not a hydration shortcut. */
export function runWithVerifiedProjectionOwner<T>(owner: RuntimeOwner, run: () => T): T {
  requireRuntimeOwner(owner); return actorContext.run({ owner: { ...owner }, explicit: true }, run);
}
/** Hydrating persisted/external views must not adopt the currently logged-in
 * viewer. Admission/fence checks remain active; only provenance promotion exits.
 */
export function runWithProjectionHydration<T>(run: () => T): T { return actorContext.exit(run); }
export interface CopStateProjectionOwner extends ProjectionStateOwner {
  init(): Promise<void>;
  usesState(state: CopState): boolean;
  producerBindingInstalled(): boolean;
  assertWriteAllowed(value: unknown, owner?: RuntimeOwner): void;
  /** Called synchronously when an accepted erasure fence commits. */
  fence(actor: RuntimeOwner, resources?: ProjectionResources): void;
}
export interface CopStateProjectionOptions {
  issuer: string;
  /** The same durable account service; loaded before any controlled producer starts. */
  cachedGuard: { ready(): boolean; assertActorAllowed(owner: RuntimeOwner): void; version?(): string | number };
  /** Read actual durable fences through an existing store/pool; no new database pool. */
  loadFences(): Promise<ProjectionFenceSnapshot>;
  /** Actual AI/index, worker, queue, archived tracks/layers and other retained copies. */
  retainedCopies: ProjectionStateOwner;
}
function rec(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function sameOwner(left: RuntimeOwner | undefined, right: RuntimeOwner): boolean { return left?.issuer === right.issuer && left.subjectId === right.subjectId; }
function clonePlain(value: unknown): unknown {
  try { return JSON.parse(boundedProjectionJSON(value)); } catch { throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE"); }
}
function deepFreeze(value: unknown): unknown {
  if (value && typeof value === "object") { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
  return value;
}
function stableId(value: unknown): string | undefined {
  const v = rec(value);
  for (const name of ["auditId", "eventId", "id", "deadLetterId", "objectId"]) if (typeof v[name] === "string") return `${name}:${v[name]}`;
  return undefined;
}
function actorMention(value: unknown, owner: RuntimeOwner): boolean {
  if (Array.isArray(value)) return value.some(item => actorMention(item, owner));
  const json = boundedProjectionJSON(value);
  return json.includes(JSON.stringify(owner.subjectId)) || (owner.subjectId.length >= 16 && json.includes(owner.subjectId));
}
function scalarStrings(value: unknown): string[] {
  const json = boundedProjectionJSON(value);
  const strings = json.match(/"(?:[^"\\]|\\.)*"/gu)?.map(item => JSON.parse(item) as string) ?? [];
  if (strings.length > 30000) throw new Error("Projection references exceed verified bound");
  return [...new Set([...strings, ...(json.match(uuidPattern) ?? []).map(id => id.toLowerCase())])];
}

/** Installs the actual state writer boundary. Existing values retain unknown
 * provenance; a login never adopts them. Record values are detached/frozen, so
 * updating them requires a checked map/array replacement. Internal witnesses
 * live in WeakMaps and never enter public JSON or API models.
 */
export function installCopStateProjectionOwner(state: CopState, options: CopStateProjectionOptions): CopStateProjectionOwner {
  if (installed.has(state)) throw new Error("COP state projection owner already installed");
  if (!options.issuer) throw new Error("COP state projection issuer required");
  const owners = new WeakMap<object, RuntimeOwner | undefined>();
  const resolverOwners = new WeakMap<object, RuntimeOwner>();
  const referenceCache = new WeakMap<object, string[]>();
  const collections = new Map<Field, Map<string, unknown> | unknown[]>();
  const bindings = new Map<Field, unknown>();
  const ownerFences = new Set<string>(), subjectFences = new Set<string>(), resourceFences = new Set<string>();
  let frontierLoaded = false, initialBinding = true, erasing = false;
  let checkedGeneration: string | number | undefined;
  const checkedActors = new Set<string>();
  const assertCachedAllowed = (owner: RuntimeOwner): void => {
    const generation = options.cachedGuard.version?.();
    if (generation !== checkedGeneration) { checkedActors.clear(); checkedGeneration = generation; }
    const key = runtimeOwnerHash(owner);
    if (generation !== undefined && checkedActors.has(key)) return;
    options.cachedGuard.assertActorAllowed(owner);
    if (generation !== undefined) { if (checkedActors.size >= 100000) checkedActors.clear(); checkedActors.add(key); }
  };

  const rawAssertWrite = (value: unknown, owner?: RuntimeOwner): void => {
    if (initialBinding || erasing) return;
    if (!frontierLoaded || !options.cachedGuard.ready()) throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE");
    if (owner) {
      requireRuntimeOwner(owner);
      assertCachedAllowed(owner);
      if (ownerFences.has(runtimeOwnerHash(owner)) || subjectFences.has(runtimeSubjectHash(owner.subjectId))) throw new ContentErasureStoreError(403, "CONTENT_PROJECTION_FENCED");
    }
    if (Array.isArray(value)) {
      if (value.length > 100000) throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE");
      for (const item of value) assertWrite(item, owner);
      return;
    }
    const references = value && typeof value === "object" && Object.isFrozen(value) ? referenceCache.get(value) ?? scalarStrings(value) : scalarStrings(value);
    if (value && typeof value === "object" && Object.isFrozen(value)) referenceCache.set(value, references);
    for (const candidate of references) {
      if (resourceFences.has(candidate.toLowerCase()) || subjectFences.has(runtimeSubjectHash(candidate))) throw new ContentErasureStoreError(403, "CONTENT_PROJECTION_FENCED");
      // An issuer field in a payload is never trusted. The configured verified
      // realm and the cached accepted job frontier decide actor admission.
      if (candidate && Buffer.byteLength(candidate) <= 512) assertCachedAllowed({ issuer: options.issuer, subjectId: candidate });
    }
  };
  const assertWrite = (value: unknown, owner?: RuntimeOwner): void => {
    try { rawAssertWrite(value, owner); }
    catch (error) {
      if (error && typeof error === "object" && "status" in error && "code" in error) throw error;
      throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE");
    }
  };
  const chooseOwner = (value: unknown, field: Field, prior?: unknown): RuntimeOwner | undefined => {
    const previous = prior && typeof prior === "object" && owners.has(prior) ? { present: true, value: owners.get(prior) } : undefined;
    if (previous) return previous.value;
    if (value && typeof value === "object" && owners.has(value)) return owners.get(value);
    const context = actorContext.getStore();
    if (!context) return undefined;
    if (context.owner.issuer !== options.issuer) throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_OWNER_CONFLICT");
    if (context.explicit || field === "idempotency" || field === "auditEvents" || actorMention(value, context.owner)) return context.owner;
    return undefined;
  };
  const snapshot = (value: unknown, field: Field, prior?: unknown): unknown => {
    const owner = initialBinding ? undefined : chooseOwner(value, field, prior);
    if (field === "trackHistory" && Array.isArray(value)) {
      const previous = new Map((Array.isArray(prior) ? prior : []).map(point => [stableId(point), point]));
      const result = value.map(point => snapshot(point, field, previous.get(stableId(point))));
      Object.freeze(result); owners.set(result, owner ? { ...owner } : undefined); return result;
    }
    assertWrite(value, owner);
    if (value && typeof value === "object" && owners.has(value) && Object.isFrozen(value)) return value;
    const result = deepFreeze(clonePlain(value));
    if (result && typeof result === "object") owners.set(result, owner ? { ...owner } : undefined);
    if (field === "domainDeadLetters" && result && typeof result === "object") {
      const existing = prior && typeof prior === "object" ? prior : value && typeof value === "object" ? value : undefined;
      const previousResolver = existing ? resolverOwners.get(existing) : undefined;
      if (previousResolver && rec(existing).resolvedBy === rec(value).resolvedBy) resolverOwners.set(result, previousResolver);
      else {
        const current = actorContext.getStore()?.owner;
        // Existing unknown history never acquires a resolver witness on renewal.
        if (!initialBinding && current && current.issuer === options.issuer && rec(value).resolvedBy === current.subjectId && rec(existing).resolvedBy === undefined) resolverOwners.set(result, { ...current });
      }
    }
    return result;
  };
  class CheckedMap extends Map<string, unknown> {
    constructor(readonly field: Field, input: Map<string, unknown>) {
      super(); for (const [key, value] of input) this.set(key, value);
    }
    override set(key: string, value: unknown): this {
      assertWrite(key, actorContext.getStore()?.owner);
      const prior = this.get(key);
      return super.set(key, snapshot(value, this.field, prior));
    }
    override delete(key: string): boolean { assertWrite(key, actorContext.getStore()?.owner); return super.delete(key); }
    override clear(): void { assertWrite("projection collection clear", actorContext.getStore()?.owner); super.clear(); }
  }
  const checkedArray = (field: Field, input: unknown[], prior?: unknown[]): unknown[] => {
    const previousById = new Map((prior ?? []).flatMap(value => stableId(value) ? [[stableId(value)!, value] as const] : []));
    const target = input.map(value => snapshot(value, field, previousById.get(stableId(value) ?? "")));
    return new Proxy(target, {
      set(array, property, value) {
        if (property === "length") { assertWrite("projection array resize", actorContext.getStore()?.owner); return Reflect.set(array, property, value); }
        const priorValue = array[Number(property)];
        const priorRecord = stableId(priorValue) === stableId(value) ? priorValue : previousById.get(stableId(value) ?? "");
        assertWrite(value, actorContext.getStore()?.owner);
        return Reflect.set(array, property, snapshot(value, field, priorRecord));
      },
      defineProperty(array, property, descriptor) {
        if (property === "length") { assertWrite("projection array resize", actorContext.getStore()?.owner); return Reflect.defineProperty(array, property, descriptor); }
        if (!("value" in descriptor)) throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE");
        assertWrite(descriptor.value, actorContext.getStore()?.owner);
        return Reflect.defineProperty(array, property, { ...descriptor, value: snapshot(descriptor.value, field) });
      },
      deleteProperty(array, property) {
        assertWrite("projection array delete", actorContext.getStore()?.owner);
        return Reflect.deleteProperty(array, property);
      }
    });
  };
  for (const field of fields) {
    const original = state[field];
    const binding = arrayFields.has(field) ? checkedArray(field, original as unknown[]) : new CheckedMap(field, original as Map<string, unknown>);
    collections.set(field, binding); bindings.set(field, binding);
    Object.defineProperty(state, field, { configurable: false, enumerable: true,
      get: () => collections.get(field),
      set: (value: unknown) => {
        if (!(value instanceof Map)) assertWrite(value, actorContext.getStore()?.owner);
        const old = collections.get(field);
        if (arrayFields.has(field)) {
          if (!Array.isArray(value)) throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE");
          const next = checkedArray(field, value, old as unknown[]); collections.set(field, next); bindings.set(field, next);
        } else {
          if (!(value instanceof Map)) throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE");
          const next = new CheckedMap(field, value); collections.set(field, next); bindings.set(field, next);
        }
      }
    });
  }
  initialBinding = false;
  const activeBinding = () => fields.every(field => state[field] === bindings.get(field) && Object.getOwnPropertyDescriptor(state, field)?.configurable === false);
  const records = (): Array<{ field: Field; key: string | number; value: unknown }> => {
    const result: Array<{ field: Field; key: string | number; value: unknown }> = [];
    for (const field of fields) {
      const collection = collections.get(field)!;
      if (collection instanceof Map) for (const [key, value] of collection) result.push({ field, key, value });
      else for (const [key, value] of collection.entries()) result.push({ field, key, value });
    }
    if (result.length > 100000) throw new ContentErasureStoreError(503, "CONTENT_PROJECTION_UNAVAILABLE");
    return result;
  };
  const classify = (field: Field, value: unknown, refs: readonly ProjectionReference[], actor: RuntimeOwner): "owned" | "association" | "unknown" | "none" => {
    const owner = value && typeof value === "object" ? owners.get(value) : undefined;
    if (field !== "sources" && field !== "federatedNodes" && sameOwner(owner, actor)) return "owned";
    const mention = actorMention(value, actor), json = (Array.isArray(value) ? value.map(item => boundedProjectionJSON(item)).join(",") : boundedProjectionJSON(value)).toLowerCase();
    const resourceMention = refs.some(ref => json.includes(ref.id));
    if (field === "domainDeadLetters" && value && typeof value === "object" && sameOwner(resolverOwners.get(value), actor)) {
      const { resolvedBy: _resolvedBy, ...withoutResolver } = rec(value);
      if (!actorMention(withoutResolver, actor) && !resourceMention) return "association";
    }
    // A source/node registry is shared operational state. Erasure cannot remove
    // the whole source just because one operator authored its latest update.
    if (field === "sources" || field === "federatedNodes") return mention || resourceMention ? "unknown" : "none";
    if (owner && (mention || resourceMention)) return "unknown";
    const v = rec(value);
    let ref: ProjectionReference | undefined;
    if (field === "events") ref = canonicalProjectionReference(String(rec(v.payload).objectId ?? ""), String(rec(v.source).sourceSystemId ?? ""));
    else if (field === "objects") ref = canonicalProjectionReference(String(v.objectId ?? ""), readObjectProvenance(value as ObservedObject)?.sourceSystemId ?? "");
    else if (field === "trackHistory") ref = canonicalProjectionReference(String(v.objectId ?? ""), String(v.sourceSystemId ?? ""));
    if (ref && refs.some(item => item.kind === ref!.kind && item.id === ref!.id)) return "owned";
    // Raw dead letters/audit/idempotency payloads cannot establish provenance.
    if (field === "domainEvents" && projectionPayloadMatch(value, refs) === "owned") return "owned";
    return mention || resourceMention ? "unknown" : "none";
  };
  const port: CopStateProjectionOwner = {
    async init() {
      const frontier = await options.loadFences();
      for (const ref of frontier.resources) resourceFences.add(ref.id.toLowerCase());
      for (const hash of frontier.ownerHashes) ownerFences.add(hash);
      for (const hash of frontier.subjectHashes) subjectFences.add(hash);
      frontierLoaded = true;
    },
    usesState: candidate => candidate === state && installed.get(state) === port,
    assertWriteAllowed: assertWrite,
    producerBindingInstalled: () => activeBinding() && installed.get(state) === port && frontierLoaded && options.cachedGuard.ready(),
    async ready() { return port.producerBindingInstalled() && await options.retainedCopies.ready(); },
    fence(actor, resources = { reportIds: [], groupIds: [] }) {
      requireRuntimeOwner(actor); ownerFences.add(runtimeOwnerHash(actor)); subjectFences.add(runtimeSubjectHash(actor.subjectId));
      for (const ref of projectionReferences(resources)) resourceFences.add(ref.id);
    },
    async preflight(actor): Promise<RuntimeOwnerAssessment> {
      requireRuntimeOwner(actor);
      if (!port.producerBindingInstalled()) return { ready: false, version: runtimeAssessment(["unbound"]).version };
      const candidates = records().filter(row => actorMention(row.value, actor) || sameOwner(row.value && typeof row.value === "object" ? owners.get(row.value) : undefined, actor));
      const copied = await options.retainedCopies.preflight(actor);
      return { ...runtimeAssessment([candidates.map(row => ({ field: row.field, key: row.key, value: row.value, knownOwner: sameOwner(row.value && typeof row.value === "object" ? owners.get(row.value) : undefined, actor) })), copied.version]),
        ready: copied.ready && candidates.every(row => ["owned", "association"].includes(classify(row.field, row.value, [], actor))) };
    },
    async erase(resources: ProjectionResources, context: ProjectionEraseContext) {
      if (!context.actor || !port.producerBindingInstalled()) return false;
      const actor = context.actor, refs = projectionReferences(resources); requireRuntimeOwner(actor); context.signal.throwIfAborted();
      port.fence(actor, resources);
      let complete = true;
      erasing = true;
      try {
        for (const field of fields) {
          const collection = collections.get(field)!;
          if (collection instanceof Map) {
            for (const [key, value] of collection) {
              if (field === "trackHistory" && Array.isArray(value)) {
                if (sameOwner(owners.get(value), actor)) { collection.delete(key); continue; }
                const retained = value.filter(point => { const kind = classify(field, point, refs, actor); if (kind === "unknown") complete = false; return kind !== "owned"; });
                if (!retained.length) collection.delete(key); else if (retained.length !== value.length) collection.set(key, retained);
                continue;
              }
              const kind = classify(field, value, refs, actor);
              if (kind === "owned") collection.delete(key); else if (kind === "unknown") complete = false;
            }
          } else {
            const retained = collection.flatMap(value => {
              const kind = classify(field, value, refs, actor); if (kind === "unknown") complete = false;
              if (kind === "owned") return [];
              if (kind === "association") { const { resolvedBy: _resolvedBy, ...withoutResolver } = rec(value); return [snapshot(withoutResolver, field, value)]; }
              return [value];
            });
            // Removing items in-place preserves the guarded array pointer.
            collection.splice(0, collection.length, ...retained);
          }
        }
      } finally { erasing = false; }
      context.signal.throwIfAborted();
      if (!await options.retainedCopies.erase(resources, context)) complete = false;
      const remaining = records().some(row => {
        if (row.field === "trackHistory" && Array.isArray(row.value)) return sameOwner(owners.get(row.value), actor) || row.value.some(point => classify(row.field, point, refs, actor) !== "none");
        return classify(row.field, row.value, refs, actor) !== "none";
      });
      context.signal.throwIfAborted(); return complete && !remaining;
    }
  };
  installed.set(state, port);
  return port;
}

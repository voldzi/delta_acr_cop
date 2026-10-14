import { createHash } from "node:crypto";
import type { AiSemanticDocument } from "./ai-semantic-retrieval.js";
import { boundedProjectionJSON, projectionReferences, type ProjectionEraseContext, type ProjectionFenceSnapshot,
  type ProjectionReference, type ProjectionResources, type ProjectionStateOwner } from "./resource-projection-erasure.js";
import { requireRuntimeOwner, runtimeAssessment, runtimeOwnerHash, runtimeSubjectHash, type RuntimeOwner, type RuntimeOwnerAssessment } from "./runtime-owner-erasure.js";

interface Provenance { resources: readonly ProjectionReference[]; owner?: RuntimeOwner }
const witnesses = new WeakMap<object, Provenance>();
const documentScopes = new WeakMap<object, AiCopyScope>();
const immutableCopies = new WeakSet<object>();
const kinds = new Set(["communityReport", "communityGroup", "incident", "task", "sketchDrawing"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = (ref: ProjectionReference) => `${ref.kind}:${ref.id.toLowerCase()}`;

/** Server-only witness. Call after validating the actual producer/resource or
 * signed owner; serialized JSON/payload fields cannot create this WeakMap entry. */
export function attachAiSemanticDocumentProvenance<T extends AiSemanticDocument>(document: T, value: { resources: readonly ProjectionReference[]; owner?: RuntimeOwner }): T {
  if (value.owner) requireRuntimeOwner(value.owner);
  const resources = value.resources.map(ref => {
    if (!kinds.has(ref.kind) || !uuid.test(ref.id)) throw new Error("AI_COPY_PROVENANCE_UNPROVEN");
    return Object.freeze({ kind: ref.kind, id: ref.id.toLowerCase() });
  });
  const next: Provenance = Object.freeze({ resources: Object.freeze([...new Map(resources.map(ref => [key(ref), ref])).values()]),
    ...(value.owner ? { owner: Object.freeze({ ...value.owner }) } : {}) });
  const previous = witnesses.get(document);
  if (previous && hash(previous) !== hash(next)) throw new Error("AI_COPY_PROVENANCE_CONFLICT");
  witnesses.set(document, next); documentScopes.delete(document); return document;
}
export function cloneAiSemanticDocument(document: AiSemanticDocument): AiSemanticDocument {
  const clone = JSON.parse(boundedProjectionJSON(document)) as AiSemanticDocument;
  const witness = witnesses.get(document);
  if (witness) attachAiSemanticDocumentProvenance(clone, witness);
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  };
  freeze(clone); immutableCopies.add(clone); return clone;
}
export interface AiCopyScope {
  resources: string[];
  owners: string[];
  subjects: string[];
  resourceMentions: string[];
  unknown: boolean;
  /** Internal immutable witness, omitted from all semantic API/model payloads. */
  verifiedOwners: RuntimeOwner[];
}
function mentions(value: unknown): { subjects: string[]; resourceMentions: string[] } {
  const json = boundedProjectionJSON(value);
  const scalars = json.match(/"(?:[^"\\]|\\.)*"/gu)?.map(item => JSON.parse(item) as string) ?? [];
  if (scalars.length > 30000) throw new Error("AI_COPY_REFERENCES_UNPROVEN");
  const resourceMentions = [...new Set((json.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/giu) ?? []).map(value => value.toLowerCase()))];
  return { subjects: [...new Set([...scalars, ...resourceMentions])].map(runtimeSubjectHash), resourceMentions };
}
export function aiDocumentScope(document: AiSemanticDocument, requester?: RuntimeOwner): AiCopyScope {
  if (requester) requireRuntimeOwner(requester);
  let base = immutableCopies.has(document) ? documentScopes.get(document) : undefined;
  if (!base) {
    const witness = witnesses.get(document), copied = mentions(document);
    base = { resources: witness?.resources.map(key) ?? [], owners: witness?.owner ? [runtimeOwnerHash(witness.owner)] : [], subjects: copied.subjects,
      verifiedOwners: witness?.owner ? [witness.owner] : [],
      resourceMentions: copied.resourceMentions, unknown: !witness && ["communityReport", "incident", "chatMessage"].includes(document.entityType) };
    if (immutableCopies.has(document)) documentScopes.set(document, base);
  }
  return requester ? { ...base, owners: [...new Set([...base.owners, runtimeOwnerHash(requester)])],
    verifiedOwners: [...new Map([...base.verifiedOwners, Object.freeze({ ...requester })].map(value => [runtimeOwnerHash(value), value])).values()] } : base;
}
export function aiQueryScope(query: string, owner?: RuntimeOwner): AiCopyScope {
  if (owner) requireRuntimeOwner(owner);
  return { resources: [], owners: owner ? [runtimeOwnerHash(owner)] : [], ...mentions(query), unknown: !owner,
    verifiedOwners: owner ? [Object.freeze({ ...owner })] : [] };
}
export function aiScopeMatch(scope: AiCopyScope, resources: readonly ProjectionReference[], owner: RuntimeOwner): "owned" | "unknown" | "none" {
  if (scope.owners.includes(runtimeOwnerHash(owner)) || resources.some(ref => scope.resources.includes(key(ref)))) return "owned";
  if (scope.unknown || scope.subjects.includes(runtimeSubjectHash(owner.subjectId)) || resources.some(ref => scope.resourceMentions.includes(ref.id.toLowerCase()))) return "unknown";
  return "none";
}
export function aiCopiesAssessment(scopes: readonly AiCopyScope[], owner: RuntimeOwner): RuntimeOwnerAssessment {
  const relevant = scopes.map(scope => ({ scope, match: aiScopeMatch(scope, [], owner) })).filter(value => value.match !== "none");
  // Bind the actor's ownership/resource impact. An unrelated public source
  // refresh or another requester's cache activity is not a changed deletion plan.
  const rows = relevant.map(({ scope, match }) => JSON.stringify({ match, resources: [...scope.resources].sort(),
    exactOwner: scope.owners.includes(runtimeOwnerHash(owner)), unresolved: scope.unknown,
    exactSubject: scope.subjects.includes(runtimeSubjectHash(owner.subjectId)) }));
  return { ...runtimeAssessment([...new Set(rows)].sort()), ready: relevant.every(value => value.match !== "unknown") };
}
export interface AiRetainedCopyStore {
  bindAiProjectionFence(fence: AiProjectionFence): boolean;
  aiProjectionFenceMatches(fence: AiProjectionFence): boolean;
  purgeFencedAiCopies(): boolean;
  preflightAiCopies(owner: RuntimeOwner): RuntimeOwnerAssessment;
  eraseAiCopies(resources: ProjectionResources, context: ProjectionEraseContext): boolean;
}
export class AiProjectionFence {
  private readonly resources = new Set<string>();
  private readonly resourceIds = new Set<string>();
  private readonly owners = new Set<string>();
  private readonly subjects = new Set<string>();
  private loaded = false;
  constructor(private readonly cachedGuard: { ready(): boolean; assertActorAllowed(owner: RuntimeOwner): void }) {}
  hydrate(snapshot: ProjectionFenceSnapshot): void {
    if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(snapshot.version)) throw new Error("AI_COPY_FRONTIER_UNPROVEN");
    if (snapshot.resources.length + snapshot.ownerHashes.length + snapshot.subjectHashes.length > 100000) throw new Error("AI_COPY_FRONTIER_UNPROVEN");
    for (const ref of snapshot.resources) { if (!kinds.has(ref.kind) || !uuid.test(ref.id)) throw new Error("AI_COPY_FRONTIER_UNPROVEN"); this.resources.add(key(ref)); this.resourceIds.add(ref.id.toLowerCase()); }
    for (const value of snapshot.ownerHashes) { if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("AI_COPY_FRONTIER_UNPROVEN"); this.owners.add(value); }
    for (const value of snapshot.subjectHashes) { if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("AI_COPY_FRONTIER_UNPROVEN"); this.subjects.add(value); }
    this.loaded = true;
  }
  ready(): boolean { return this.loaded && this.cachedGuard.ready(); }
  fence(owner: RuntimeOwner, resources: ProjectionResources = { reportIds: [], groupIds: [] }): void {
    requireRuntimeOwner(owner); this.owners.add(runtimeOwnerHash(owner)); this.subjects.add(runtimeSubjectHash(owner.subjectId));
    for (const ref of projectionReferences(resources)) { this.resources.add(key(ref)); this.resourceIds.add(ref.id.toLowerCase()); }
  }
  allows(scope: AiCopyScope, owner?: RuntimeOwner): boolean {
    if (!this.ready()) throw new Error("AI_COPY_FRONTIER_UNAVAILABLE");
    if (owner && this.actorFenced(owner)) return false;
    return this.matchFenced(scope) === "none";
  }
  matchFenced(scope: AiCopyScope): "owned" | "unknown" | "none" {
    if (scope.verifiedOwners.some(owner => this.actorFenced(owner))) return "owned";
    if (scope.owners.some(value => this.owners.has(value)) || scope.resources.some(value => this.resources.has(value))) return "owned";
    // Unknown mention of a fenced resource is rejected; never infer ownership
    // from a coincidental UUID and never forward it to the embedding provider.
    return scope.subjects.some(value => this.subjects.has(value)) || scope.resourceMentions.some(id => this.resourceIds.has(id)) ? "unknown" : "none";
  }
  private actorFenced(owner: RuntimeOwner): boolean {
    try { this.cachedGuard.assertActorAllowed(owner); return false; }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : error instanceof Error ? error.message : undefined;
      if (code === "ACCOUNT_ERASURE_FENCED" || code === "ACCOUNT_REVOKED") return true;
      throw error; // An unavailable/unloaded/foreign guard never means allowed.
    }
  }
  assertAllowed(scope: AiCopyScope, owner?: RuntimeOwner): void { if (!this.allows(scope, owner)) throw new Error("AI_COPY_FENCED"); }
}
export interface AiRetainedCopiesOwner extends ProjectionStateOwner {
  init(): Promise<void>;
  fence(owner: RuntimeOwner, resources?: ProjectionResources): void;
  producerBindingInstalled(): boolean;
}
export function createAiRetainedCopiesErasure(options: {
  contextIndexes: readonly AiRetainedCopyStore[];
  semanticRetrievers: readonly AiRetainedCopyStore[];
  cachedGuard: { ready(): boolean; assertActorAllowed(owner: RuntimeOwner): void };
  loadFences(): Promise<ProjectionFenceSnapshot>;
}): AiRetainedCopiesOwner {
  const stores = [...new Set([...options.contextIndexes, ...options.semanticRetrievers])];
  const fence = new AiProjectionFence(options.cachedGuard);
  const installed = options.contextIndexes.length > 0 && options.semanticRetrievers.length > 0 && stores.every(store => store.bindAiProjectionFence(fence));
  let initialization: Promise<void> | undefined;
  const bound = () => installed && stores.every(store => store.aiProjectionFenceMatches(fence));
  const port: AiRetainedCopiesOwner = {
    producerBindingInstalled: bound,
    async init() {
      if (!bound()) throw new Error("AI_COPY_BINDING_UNAVAILABLE");
      initialization ??= options.loadFences().then(snapshot => fence.hydrate(snapshot)).catch(error => { initialization = undefined; throw error; });
      await initialization;
    },
    async ready() { try { await port.init(); return bound() && fence.ready() && stores.map(store => store.purgeFencedAiCopies()).every(Boolean); } catch { return false; } },
    fence(owner, resources) {
      fence.fence(owner, resources);
      const context: ProjectionEraseContext = { actor: owner, operationId: "committed-cop-account-fence", signal: new AbortController().signal };
      for (const store of stores) store.eraseAiCopies(resources ?? { reportIds: [], groupIds: [] }, context);
    },
    async preflight(owner) {
      requireRuntimeOwner(owner);
      if (!await port.ready()) return { ready: false, version: hash(["ai-copies-unavailable"]) };
      const assessments = stores.map(store => store.preflightAiCopies(owner));
      return { ...runtimeAssessment(assessments.map(value => value.version)), ready: assessments.every(value => value.ready) };
    },
    async erase(resources, context) {
      context.signal.throwIfAborted();
      if (!context.actor || !await port.ready()) return false;
      requireRuntimeOwner(context.actor); fence.fence(context.actor, resources);
      const results = stores.map(store => store.eraseAiCopies(resources, context));
      context.signal.throwIfAborted();
      return results.every(Boolean);
    }
  };
  return port;
}

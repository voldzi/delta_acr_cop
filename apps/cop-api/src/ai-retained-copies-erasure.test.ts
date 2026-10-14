import { describe, expect, it, vi } from "vitest";
import { AiContextIndex } from "./ai-context-index.js";
import { AiSemanticRetriever, createSemanticDocuments } from "./ai-semantic-retrieval.js";
import { attachAiSemanticDocumentProvenance, createAiRetainedCopiesErasure } from "./ai-retained-copies-erasure.js";
import { runtimeOwnerHash, runtimeSubjectHash } from "./runtime-owner-erasure.js";
import type { ProjectionFenceSnapshot } from "./resource-projection-erasure.js";

const owner = { issuer: "https://synthetic.test/realms/cop", subjectId: "980d7bfc-ee75-46e5-9a9c-450379e9172e" };
const other = { ...owner, subjectId: "a50a52b9-1990-48ef-ae0b-14ce24f957ac" };
const reportA = "e8b7d2f3-24d7-46b7-af2e-3542ecf1e9e0", reportB = "b84f77fb-84cc-460a-9f51-9a0928cbb7c0";
const date = new Date("2026-10-14T09:00:00Z"), embedding = { embedding: [1, 0], model: "synthetic-no-provider" };
const resources = { reportIds: [reportA], groupIds: [] };
const context = () => ({ operationId: "39d8fe62-3977-4f6d-8153-05a758721460", actor: owner, signal: new AbortController().signal });
const frontier = (): ProjectionFenceSnapshot => ({ resources: [], ownerHashes: [], subjectHashes: [], version: "synthetic-frontier-v1" });
const documents = () => {
  const result = createSemanticDocuments({ communityReports: [{ reportId: reportA, title: "A private derivation", description: "First report" },
    { reportId: reportB, title: "B report", description: "Second report" }], sourceHealth: [{ sourceSystemId: "synthetic-system-health", health: "ONLINE" }] });
  attachAiSemanticDocumentProvenance(result[0]!, { resources: [{ kind: "communityReport", id: reportA }], owner });
  attachAiSemanticDocumentProvenance(result[1]!, { resources: [{ kind: "communityReport", id: reportB }], owner: other });
  return result;
};
function fixture(options: { snapshot?: ProjectionFenceSnapshot; embedText?: ConstructorParameters<typeof AiSemanticRetriever>[0]["embedText"]; loadFailure?: boolean } = {}) {
  const index = new AiContextIndex(), embedText = vi.fn(options.embedText ?? (async () => embedding));
  const retriever = new AiSemanticRetriever({ embedText });
  const loadFences = vi.fn(async () => { if (options.loadFailure) throw new Error("synthetic store outage"); return options.snapshot ?? frontier(); });
  const revoked = new Set<string>();
  const cachedGuard = { ready: () => true, assertActorAllowed: (value: typeof owner) => { if (revoked.has(runtimeOwnerHash(value))) throw new Error("ACCOUNT_REVOKED"); } };
  const port = createAiRetainedCopiesErasure({ contextIndexes: [index], semanticRetrievers: [retriever], loadFences, cachedGuard });
  return { index, retriever, port, embedText, loadFences, cachedGuard, revoked };
}
async function ticks() { for (let i = 0; i < 15; i++) await Promise.resolve(); }

describe("actual AI RAM projection ownership, refresh and embedding boundaries", () => {
  it("requires actual frontier hydration and immutable per-instance binding", async () => {
    const f = fixture({ loadFailure: true });
    expect(await f.port.ready()).toBe(false);
    expect(() => f.index.replaceDocuments(documents(), { indexedAt: date, reason: "before-guard-hydration" })).toThrow("FRONTIER_UNAVAILABLE");
    const good = fixture(); await good.port.init(); expect(await good.port.ready()).toBe(true);
    const second = createAiRetainedCopiesErasure({ contextIndexes: [good.index], semanticRetrievers: [good.retriever],
      loadFences: async () => frontier(), cachedGuard: good.cachedGuard });
    expect(await second.ready()).toBe(false); expect(await good.port.ready()).toBe(true);
  });
  it("purges actual owned documents/vectors and retains the other user and system documents", async () => {
    const f = fixture(); await f.port.init(); const initial = documents();
    f.index.replaceDocuments(initial, { indexedAt: date, reason: "server-verified" });
    expect(await f.port.preflight(owner)).toMatchObject({ ready: true });
    const before = await f.index.query(f.retriever, { generatedAt: date, query: "synthetic question", owner: other });
    expect(before.semanticContext.items).toHaveLength(3); expect(f.retriever.retainedCopyDiagnostics().embeddingCacheEntries).toBe(4);
    expect(await f.port.erase(resources, context())).toBe(true);
    expect(f.index.diagnostics().documentCount).toBe(2);
    const after = await f.index.query(f.retriever, { generatedAt: date, query: "synthetic question", owner: other });
    expect(after.semanticContext.items.map(item => item.entityId).sort()).toEqual([reportB, "synthetic-system-health"].sort());
    expect(JSON.stringify(after)).not.toContain("A private derivation");
    expect(await f.port.erase(resources, context())).toBe(true);
    await expect(f.retriever.retrieve({ documents: initial, generatedAt: date, query: "new synthetic", owner })).rejects.toThrow("AI_COPY_FENCED");
  });
  it("does not restore deleted data from a late refresh or from mutation of the producer's original object", async () => {
    const f = fixture(); await f.port.init(); const original = documents();
    f.index.replaceDocuments(original, { indexedAt: date, reason: "snapshot-before-erasure" });
    original[0]!.text = "Producer tried to mutate retained text";
    const prior = await f.index.query(f.retriever, { generatedAt: date, query: "synthetic", owner: other });
    expect(JSON.stringify(prior)).not.toContain("Producer tried");
    expect(await f.port.erase(resources, context())).toBe(true);
    f.index.replaceDocuments(original, { indexedAt: date, reason: "late-snapshot-after-erasure" });
    expect(f.index.diagnostics().documentCount).toBe(2);
    const after = await f.index.query(f.retriever, { generatedAt: date, query: "synthetic", owner: other });
    expect(after.semanticContext.items.some(item => item.entityId === reportA)).toBe(false);
  });
  it("blocks a background creator copy immediately at the real global fence before any resource erasure manifest exists", async () => {
    const f = fixture(); await f.port.init(); const oldSnapshot = documents();
    f.index.replaceDocuments(oldSnapshot, { indexedAt: date, reason: "captured-before-global-fence" });
    f.revoked.add(runtimeOwnerHash(owner)); // Actual controller committed; no port/resource fence call.
    f.index.replaceDocuments(oldSnapshot, { indexedAt: date, reason: "late-background-snapshot" });
    expect(f.index.diagnostics().documentCount).toBe(2);
    const beforeCalls = f.embedText.mock.calls.length;
    const answer = await f.retriever.retrieve({ documents: oldSnapshot, generatedAt: date, query: "B public question", owner: other });
    expect(answer.items.map(item => item.entityId).sort()).toEqual([reportB, "synthetic-system-health"].sort());
    expect(f.embedText.mock.calls.slice(beforeCalls).some(([text]) => text.includes(reportA))).toBe(false);
    expect(await f.port.ready()).toBe(true);
  });
  it("keeps actor-specific preflight stable across another user's query or an unrelated system refresh", async () => {
    const f = fixture(); await f.port.init(); f.index.replaceDocuments(documents(), { indexedAt: date, reason: "initial" });
    const before = await f.port.preflight(owner);
    await f.retriever.retrieve({ documents: documents().slice(1), generatedAt: date, query: "B question", owner: other });
    const replacement = documents(); replacement[2]!.text = "System health changed independently";
    f.index.replaceDocuments(replacement, { indexedAt: date, reason: "unrelated-system-refresh" });
    expect(await f.port.preflight(owner)).toEqual(before);
  });
  it("does not use serialized issuer/owner/resource claims as provenance or adopt old retained copies after today's attestation", async () => {
    const f = fixture(); await f.port.init();
    const ambiguous = createSemanticDocuments({ communityReports: [{ reportId: reportA, subjectId: owner.subjectId, issuer: owner.issuer,
      erasureProvenance: { resources: [{ kind: "communityReport", id: reportA }], owner }, title: "Unproven old copy" }] });
    f.index.replaceDocuments(ambiguous, { indexedAt: date, reason: "legacy" });
    attachAiSemanticDocumentProvenance(ambiguous[0]!, { resources: [{ kind: "communityReport", id: reportA }], owner });
    expect(await f.port.preflight(owner)).toMatchObject({ ready: false });
    expect(await f.port.erase(resources, context())).toBe(false);
    expect(f.index.diagnostics().documentCount).toBe(1);
  });
  it("holds cleanup pending for a started provider promise that ignores abort, then prevents late vector refill", async () => {
    let finish!: (value: typeof embedding) => void;
    const f = fixture({ embedText: async input => input.startsWith("query\n") ? embedding : new Promise(resolve => { finish = resolve; }) });
    await f.port.init();
    const run = f.retriever.retrieve({ documents: documents().slice(0, 1), generatedAt: date, query: "owned synthetic question", owner });
    await ticks(); expect(f.embedText).toHaveBeenCalledTimes(2);
    expect(f.retriever.retainedCopyDiagnostics().activeProviderEmbeddings).toBe(1);
    expect(await f.port.erase(resources, context())).toBe(false);
    expect(await run).toMatchObject({ status: "degraded", items: [] });
    expect(f.retriever.retainedCopyDiagnostics()).toMatchObject({ activeProviderEmbeddings: 1, embeddingCacheEntries: 0 });
    expect(await f.port.erase(resources, context())).toBe(false);
    finish(embedding); await ticks();
    expect(await f.port.erase(resources, context())).toBe(true);
    expect(f.retriever.retainedCopyDiagnostics()).toMatchObject({ activeProviderEmbeddings: 0, embeddingCacheEntries: 0 });
  });
  it("starts no provider operation when the synchronous committed fence arrives before the queued embedding task", async () => {
    const f = fixture(); await f.port.init();
    const run = f.retriever.retrieve({ documents: documents(), generatedAt: date, query: "A queued query", owner });
    f.port.fence(owner, resources);
    expect(await run).toMatchObject({ status: "degraded", items: [] });
    expect(f.embedText).not.toHaveBeenCalled();
    expect(f.retriever.retainedCopyDiagnostics()).toEqual({ embeddingCacheEntries: 0, activeProviderEmbeddings: 0, activeRuns: 0 });
    expect(await f.port.erase(resources, context())).toBe(true);
  });
  it("aborts an in-flight index query from another requester when its report is erased and does not return a stale citation", async () => {
    let finish!: (value: typeof embedding) => void;
    const f = fixture({ embedText: async input => input.startsWith("query\n") ? embedding : new Promise(resolve => { finish = resolve; }) });
    await f.port.init(); f.index.replaceDocuments(documents().slice(0, 1), { indexedAt: date, reason: "live" });
    const run = f.index.query(f.retriever, { generatedAt: date, query: "another user's synthetic question", owner: other });
    await ticks(); expect(f.embedText).toHaveBeenCalledTimes(2);
    expect(await f.port.erase(resources, context())).toBe(false);
    expect((await run).semanticContext).toMatchObject({ status: "degraded", items: [], citations: [] });
    expect(f.index.diagnostics().documentCount).toBe(0);
    finish(embedding); await ticks(); expect(await f.port.erase(resources, context())).toBe(true);
    expect(f.retriever.retainedCopyDiagnostics().embeddingCacheEntries).toBe(1); // B's query only
  });
  it("hydrates permanent resource and owner frontiers and actually purges old witnessed copies without removing system data", async () => {
    const index = new AiContextIndex(), retriever = new AiSemanticRetriever({ embedText: async () => embedding });
    index.replaceDocuments(documents(), { indexedAt: date, reason: "old-snapshot" });
    await retriever.retrieve({ documents: documents(), generatedAt: date, query: "old synthetic", owner });
    const port = createAiRetainedCopiesErasure({ contextIndexes: [index], semanticRetrievers: [retriever], cachedGuard: { ready: () => true, assertActorAllowed: () => undefined },
      loadFences: async () => ({ resources: [{ kind: "communityReport", id: reportA }], ownerHashes: [runtimeOwnerHash(owner)], subjectHashes: [runtimeSubjectHash(owner.subjectId)], version: "actual-synthetic-frontier-v2" }) });
    await port.init(); expect(await port.ready()).toBe(true);
    expect(index.diagnostics().documentCount).toBe(2);
    expect(retriever.retainedCopyDiagnostics().embeddingCacheEntries).toBe(0); // All earlier derivatives requested by A
    index.replaceDocuments(documents(), { indexedAt: date, reason: "old-repeat" });
    expect(index.diagnostics().documentCount).toBe(2);
  });
  it("does not cache unattributed query vectors after binding and blocks unresolved active query ownership", async () => {
    const f = fixture(); await f.port.init();
    const system = documents().slice(2);
    await f.retriever.retrieve({ documents: system, generatedAt: date, query: "unattributed query" });
    expect(f.retriever.retainedCopyDiagnostics().embeddingCacheEntries).toBe(1); // System document, no query vector
    expect(await f.port.preflight(owner)).toMatchObject({ ready: true });
    let finish!: (value: typeof embedding) => void;
    const active = fixture({ embedText: async () => new Promise(resolve => { finish = resolve; }) }); await active.port.init();
    const run = active.retriever.retrieve({ documents: system, generatedAt: date, query: "unattributed old query" });
    await ticks(); expect(await active.port.preflight(owner)).toMatchObject({ ready: false });
    finish(embedding); await ticks();
    // The subsequent system-document embedding also remains a real provider operation.
    finish(embedding); await run;
    expect(await active.port.preflight(owner)).toMatchObject({ ready: true });
  });
});

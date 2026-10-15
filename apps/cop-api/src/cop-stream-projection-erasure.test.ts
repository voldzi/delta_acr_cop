import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ObservedObject } from "@cop/canonical-model";
import { contentOwnerKey } from "./content-erasure.js";
import { eraseProvenStreamChanges } from "./cop-stream-projection-erasure.js";
import { projectionReferences } from "./resource-projection-erasure.js";

const a = { issuer: "https://synthetic.test/realms/cop", subjectId: "synthetic-a" };
const b = { ...a, subjectId: "synthetic-b" };
const owned = randomUUID(), foreign = randomUUID();
export function reportObject(id: string, source = "community_reports"): ObservedObject {
  return { objectId: id, objectType: "REPORT", affiliation: "NEUTRAL", domain: "LAND", status: "ACTIVE", synthetic: true,
    attributes: { provenance: { sourceSystemId: source } } };
}
const envelope = () => ({ originId: "synthetic-origin", message: { type: "delta" as const, sequence: 42, serverTimestamp: "2026-10-15T00:00:00Z",
  changes: [owned, foreign].map(id => ({ changeType: "OBJECT_UPSERT" as const, object: reportObject(id) })) } });
const refs = projectionReferences({ reportIds: [owned], groupIds: [] });
const bindings = () => [{ change_index: 0, owner_key: contentOwnerKey(a), kind: "communityReport", resource_id: owned },
  { change_index: 1, owner_key: contentOwnerKey(b), kind: "communityReport", resource_id: foreign }];

describe("stream per-change provenance erasure", () => {
  it("removes only the separately bound A change and preserves B and envelope metadata", () => {
    const value = envelope(), result = eraseProvenStreamChanges(value, bindings(), refs, a);
    expect(result.complete).toBe(true); expect(result.removed).toBe(1); expect(result.indexes).toEqual([0]);
    expect(result.envelope).toEqual({ ...value, message: { ...value.message, changes: [value.message.changes[1]] } });
    expect(value.message.changes).toHaveLength(2);
  });
  it("does not infer ownership from a canonical payload without a publication binding", () => {
    const value = envelope(), result = eraseProvenStreamChanges(value, [], refs, a);
    expect(result.complete).toBe(false); expect(result.removed).toBe(0); expect(result.envelope).toEqual(value);
  });
  it.each(["wrong owner", "wrong resource", "wrong source"])("rejects %s in an otherwise plausible row", scenario => {
    const value = envelope(), proof = bindings();
    if (scenario === "wrong owner") proof[0]!.owner_key = contentOwnerKey(b);
    if (scenario === "wrong resource") proof[0]!.resource_id = foreign;
    if (scenario === "wrong source") value.message.changes[0]!.object = reportObject(owned, "foreign_edge");
    const result = eraseProvenStreamChanges(value, proof, refs, a);
    expect(result.complete).toBe(false); expect(result.removed).toBe(0); expect(result.envelope).toEqual(value);
  });
  it("keeps unexplained owner text pending even after a proven change is selected", () => {
    const value = envelope(); value.message.changes[1]!.object.attributes!.note = a.subjectId;
    expect(eraseProvenStreamChanges(value, bindings(), refs, a).complete).toBe(false);
  });
});

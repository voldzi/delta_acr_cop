import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ContentErasureStoreError } from "./content-erasure.js";

/** Administrative classification of exact historical hardcoded-lab writes.
 * It is deliberately not an OIDC issuer or an account ownership witness. */
export const legacyNonAccountProvenanceSchema = `
CREATE TABLE IF NOT EXISTS cop_legacy_nonaccount_provenance (
 kind text NOT NULL CHECK (kind IN ('report','group','membership','confirmation')),
 row_key text NOT NULL,
 writer_kind text NOT NULL CHECK (writer_kind='hardcoded_lab'),
 source_revision text NOT NULL CHECK (source_revision='b13fbdc71f3d9821f8b857c3f73255a75c46fa76'),
 evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
 row_sha256 text NOT NULL CHECK (row_sha256 ~ '^[a-f0-9]{64}$'),
 ownership_sha256 text NOT NULL CHECK (ownership_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY (kind,row_key)
);`;
const sourceRevision = "b13fbdc71f3d9821f8b857c3f73255a75c46fa76";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const key = (kind: string, rowKey: string) => JSON.stringify([kind, rowKey]);
const resources: Record<string, { table: string; rowKey: string; subject: string }> = {
 report: { table: "cop_community_reports", rowKey: "r.report_id::text", subject: "r.subject_id" },
 group: { table: "cop_community_groups", rowKey: "r.group_id::text", subject: "r.owner_subject_id" },
 membership: { table: "cop_community_group_members", rowKey: "r.group_id::text||':'||r.subject_id", subject: "r.subject_id" },
 confirmation: { table: "cop_community_report_confirmations", rowKey: "r.report_id::text||':'||r.subject_id", subject: "r.subject_id" }
};
/** A changed row, changed insertion witness, orphan marker or unknown type
 * invalidates readiness. No current session or display name is consulted. */
export async function verifiedLegacyNonAccountRows(client: Pick<PoolClient, "query">): Promise<Set<string>> {
 await client.query("SET LOCAL TimeZone='UTC'");
 const ledger = await client.query<{ kind: string; row_key: string; writer_kind: string; source_revision: string; evidence_digest: string; row_sha256: string; ownership_sha256: string }>(
  "SELECT kind,row_key,writer_kind,source_revision,evidence_digest,row_sha256,ownership_sha256 FROM cop_legacy_nonaccount_provenance ORDER BY kind,row_key LIMIT 1001");
 if (ledger.rows.length > 1000) throw new Error("LEGACY_NONACCOUNT_BOUND_EXCEEDED");
 const verified = new Set<string>();
 for (const row of ledger.rows) {
  const spec = resources[row.kind];
  if (!spec || row.writer_kind !== "hardcoded_lab" || row.source_revision !== sourceRevision || !/^[a-f0-9]{64}$/u.test(row.evidence_digest)) throw new Error("LEGACY_NONACCOUNT_PROVENANCE_UNVERIFIED");
  const current = await client.query<{ row_text: string; subject_id: string }>(`SELECT to_jsonb(r)::text AS row_text,${spec.subject} AS subject_id FROM ${spec.table} r WHERE ${spec.rowKey}=$1`, [row.row_key]);
  const witnesses = await client.query<{ row_text: string; subject_id: string; issuer: string | null }>("SELECT to_jsonb(o)::text AS row_text,o.subject_id,o.issuer FROM cop_community_erasure_ownership o WHERE o.kind=$1 AND o.row_key=$2", [row.kind, row.row_key]);
  const witness = witnesses.rows[0];
  if (current.rows.length !== 1 || current.rows[0]!.subject_id !== "lab" || digest(current.rows[0]!.row_text) !== row.row_sha256 || witnesses.rows.length > 1 || (witness && (witness.subject_id !== "lab" || witness.issuer !== null)) || digest(witness?.row_text ?? "null") !== row.ownership_sha256) throw new Error("LEGACY_NONACCOUNT_ROW_CHANGED");
  verified.add(key(row.kind, row.row_key));
 }
 return verified;
}
export const isVerifiedLegacyNonAccount = (rows: Set<string>, kind: string, rowKey: string): boolean => rows.has(key(kind, rowKey));
/** Classified historical system rows remain immutable to all application
 * writers. In particular an OIDC actor can never adopt the lab identifier. */
export async function assertNoLegacyNonAccountWrite(client: Pick<PoolClient, "query">, targets: readonly { kind: string; rowKey: string }[]): Promise<void> {
 for (const target of targets) {
  if ((await client.query("SELECT 1 FROM cop_legacy_nonaccount_provenance WHERE kind=$1 AND row_key=$2", [target.kind, target.rowKey])).rowCount) throw new ContentErasureStoreError(404, "COMMUNITY_RESOURCE_NOT_FOUND");
 }
}

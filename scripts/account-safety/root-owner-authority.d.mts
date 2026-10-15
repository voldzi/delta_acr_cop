/** Private Root ABI. Declarations are not authority or a production binding. */
export interface RootEvidenceRef { readonly recordId: string; readonly digest: string }
export interface RootKernelPeer { readonly device: string; readonly inode: string; readonly uid: number; readonly gid: number }
export type RootOwner = "sim_driver_measurements" | "sim_ai_router";
export type RootOwnerPurpose = "read" | "mutation" | "publication" | "retention" | "checkpoint-read" | "checkpoint-publish";
interface PolicyBase {
  readonly contractVersion: "cop-root-owner-policy-v1";
  readonly reference: RootEvidenceRef;
  readonly identityEvidenceRef: RootEvidenceRef;
  readonly retentionEvidenceRef: RootEvidenceRef;
  readonly schemaEvidenceRef: RootEvidenceRef;
  readonly privilegeEvidenceRef: RootEvidenceRef;
  readonly schemaFingerprint: string;
  readonly privilegeFingerprint: string;
}
export interface RootDriverPolicy extends PolicyBase {
  readonly owner: "sim_driver_measurements";
  readonly scope: "online_driver_scope";
  readonly expectedCheckpointHash: string;
  readonly reportProtection: "no_report" | "enforced_single_writer" | "shared_generation_fence";
  /** Global independently accepted runtime/report inventory, not the per-read
   * driver-report-inventory or per-operation report-inventory it authorizes. */
  readonly reportPolicyRef: RootEvidenceRef;
  readonly transition?: {
    readonly contractVersion: "cop-root-driver-checkpoint-transition-v1";
    readonly intentRef: RootEvidenceRef;
    readonly operationId: string;
    readonly expectedPreviousCheckpointHash: string | null;
    readonly checkpointHash: string;
    readonly proofValidUntilUTC: string;
    readonly replayReady: boolean;
    readonly retentionReviewed: boolean;
    readonly reportProtection: "unverified" | "no_report" | "enforced_single_writer" | "shared_generation_fence";
    readonly publicationFenceVerified: boolean;
  };
}
export interface RootAiPolicy extends PolicyBase {
  readonly owner: "sim_ai_router";
  readonly scope: "cop_router_primary_database";
  readonly costPolicy: "aggregate-costs-current-month-v1";
  readonly costEvidenceRef: RootEvidenceRef;
  readonly expectedSnapshot: { readonly checkpointId: string; readonly generation: string; readonly operationDigest: string; readonly schemaDigest: string };
  readonly transition?: {
    readonly contractVersion: "cop-root-ai-checkpoint-transition-v1";
    readonly intentRef: RootEvidenceRef;
    readonly operationId: string;
    /** Existing target checkpoint only; SQL005 never inserts/adopts a new row. */
    readonly expectedCheckpointId: string;
    readonly expectedGeneration: string;
    readonly checkpointId: string;
    readonly generation: string;
    /** Expected pre-CAS snapshot digests. SQL005 does not overwrite them. */
    readonly operationDigest: string;
    readonly schemaDigest: string;
    readonly identityReviewed: boolean;
    readonly replayReady: boolean;
    readonly costPolicy: "pending_requires_review" | "aggregate-costs-current-month-v1";
    readonly proofValidUntilUTC: string;
  };
}
export interface RootOwnerAuthority {
  readonly contractVersion: "cop-root-owner-authority-v1";
  readonly owner: RootOwner;
  readonly scope: "online_driver_scope" | "cop_router_primary_database";
  readonly purpose: RootOwnerPurpose;
  readonly registration: Readonly<Record<string, unknown>>;
  readonly peer: RootKernelPeer;
  readonly guardStoreId: string;
  readonly continuityEpoch: string;
  readonly protectedConfigId: string;
  readonly datasetBindingId: string;
  readonly runtimeBindingId: string;
  readonly sourceProofId: string;
  readonly policyGeneration: number;
  readonly frontierSequence: number;
  readonly frontierDigest: string;
  readonly storeIncarnation: string;
  readonly expiresAtUTC: string;
  readonly reference: RootEvidenceRef;
  readonly rootPolicy: RootDriverPolicy | RootAiPolicy;
  readonly keys: Readonly<Record<string, unknown>>;
  /** Actual current evidence/lease recheck. Not an application callback. */
  assertCurrent(): Promise<void>;
  /** Settles this actual held read/writer lease; unknown remains Root HOLD. */
  close(): Promise<void>;
}
/** Fixed protected files, actual host/runtime/store observations, independent
 * registry/frontier, signatures and current held lease. No caller-selected
 * profile, URL, SQL, Root UUID or positive verifier. */
export function requireCurrentOwner(owner: RootOwner, peer: RootKernelPeer, purpose: RootOwnerPurpose): Promise<RootOwnerAuthority>;
/** An actual target-session uncertainty preserves its original exclusive
 * metadata barrier; close/expiry cannot turn it into a drained operation. */
export function holdOwnerLease(authority: RootOwnerAuthority): void;
export function assertCopJournalActor(peer: RootKernelPeer, actor: { readonly iss: string; readonly sub: string; readonly operationId: string; readonly routerUserId: string }, businessOperationId: string): Promise<{
  readonly accountKey: string; readonly operationId: string; readonly requestedAt: string; readonly journalSequence: number;
  readonly entryDigest: string; readonly frontierSequence: number; readonly frontierDigest: string; readonly reference: RootEvidenceRef;
}>;
/** Consent withdrawal is a distinct accepted daily intent, never a whole-account
 * fence. Verify actual signed claim, daily derivation and session/consent source. */
export function assertCopRevocationIntent(peer: RootKernelPeer, scope: Readonly<Record<string, unknown>>): Promise<RootEvidenceRef>;
/** Root-derived full current/historical daily IDs, actual candidate lookup and
 * COP pending outbox. Original anchor is from actual owner SQL, never HTTP. */
export function assertCopDriverErasureManifest(peer: RootKernelPeer, actor: { readonly iss: string; readonly sub: string; readonly operationId: string; readonly routerUserId: string },
  request: Readonly<Record<string, unknown>>, originalAcceptedAt: string): Promise<RootEvidenceRef>;
/** Actual held exclusive publication barrier + independently accepted report
 * policy + actual locked readback, not a no_report label or callback success. */
export function requirePublicationBarrier(authority: RootOwnerAuthority, facts: {
  readonly operationDigest: string; readonly readbackDigest: string; readonly reportProtection: string; readonly storeIncarnation: string;
  readonly eraseOriginId: string; readonly baseBody: Readonly<Record<string, unknown>>; readonly observedAtUTC: string;
}): Promise<RootEvidenceRef>;
/** Private exact kind allowlist chooses only fixed ephemeral directories.
 * Actual lease/current evidence is rechecked before and after signing. */
export function issueOwnerEphemeralRecord(authority: RootOwnerAuthority, kind: string,
  facts: Readonly<Record<string, unknown>>, recordId?: string): Promise<RootEvidenceRef & { readonly bytes: Uint8Array }>;
/** Uses the independently accepted transition.operationId; never replaces an
 * uncertain intent with a new UUID/body/date. Body excludes rootRecordRef to
 * avoid a self-referential digest. Target reconciliation remains actual SQL. */
export function beginOwnerPublicationIntent(authority: RootOwnerAuthority, body: Readonly<Record<string, unknown>>): Promise<
  RootEvidenceRef & { readonly operationId: string; readonly bodyDigest: string; readonly originalBody: Readonly<Record<string, unknown>> }
>;

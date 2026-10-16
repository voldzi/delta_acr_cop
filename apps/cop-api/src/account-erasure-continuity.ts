import type { AccountErasureAdapterId } from "./account-erasure.js";

export interface AccountErasureFrontier { sequence: number; digest: string }
/** Administrator-enrolled dataset identity, not a completion/provider proof. */
export interface AccountErasureDatasetBinding { incarnationId: string; restoreGeneration: number }
/** Permanent fence metadata only. No recoverable principal, name, email, user
 * text or provider key. The account MAC is pseudonymous, not anonymous. */
export interface AccountErasureFenceEntry {
  contractVersion: "cop-erasure-fence-entry-v1";
  applicationStoreId: string;
  configurationFingerprint: string;
  accountKey: string;
  job: {
    operationId: string;
    requestedAt: string;
    required: AccountErasureAdapterId[];
    checkpoints: Record<string, never>;
  };
}
export interface AccountErasureReplay {
  contractVersion: "cop-erasure-replay-v1";
  applicationStoreId: string;
  configurationFingerprint: string;
  frontier: AccountErasureFrontier;
  entries: AccountErasureFenceEntry[];
  datasetBinding?: AccountErasureDatasetBinding;
}
/** Server-only production port. Implementations must check the actual protected
 * peer/signatures, current independent journal and runtime/store binding.
 * An application boolean or synthetic callback is not a production authority. */
export interface AccountErasureContinuity {
  readonly requiresDatasetBinding?: true;
  close?(): Promise<void>;
  snapshot(): Promise<AccountErasureReplay>;
  assertCurrent(frontier: AccountErasureFrontier): Promise<{ validUntil: string }>;
  /** Commits independent Root journal before the local fence transaction.
   * An existing operation returns its immutable original job, never a newly
   * dated/resealed replacement. Unknown outcomes are resolved by the journal. */
  publishFence(entry: AccountErasureFenceEntry): Promise<{
    frontier: AccountErasureFrontier; entry: AccountErasureFenceEntry;
  }>;
}

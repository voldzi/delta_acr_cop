export interface CopRootFrontier { readonly sequence: number; readonly digest: string }
export interface CopRootFenceEntry {
  readonly contractVersion: "cop-erasure-fence-entry-v1";
  readonly applicationStoreId: string;
  readonly configurationFingerprint: string;
  readonly accountKey: string;
  readonly job: {
    readonly operationId: string;
    readonly requestedAt: string;
    readonly required: readonly ("keycloak" | "cop_sessions_profiles" | "cop_devices" | "messaging_matrix" | "voice_livekit" |
      "cop_content_media" | "mobility_dispatch" | "sim_measurements" | "ai_router" | "moderation_audit" | "backup_restore")[];
    readonly checkpoints: Readonly<Record<string, never>>;
  };
}
/** This permanent metadata contains no recoverable principal. */
export function createProductionAccountErasureContinuity(): {
  snapshot(): Promise<{ readonly contractVersion: "cop-erasure-replay-v1"; readonly applicationStoreId: string;
    readonly configurationFingerprint: string; readonly frontier: CopRootFrontier; readonly entries: readonly CopRootFenceEntry[] }>;
  assertCurrent(frontier: CopRootFrontier): Promise<{ readonly validUntil: string }>;
  publishFence(entry: CopRootFenceEntry): Promise<{ readonly frontier: CopRootFrontier; readonly entry: CopRootFenceEntry }>;
};

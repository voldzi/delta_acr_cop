export type DriverRootKind = "expire" | "revoke" | "erase" | "ack";
export interface DriverRootOperation { readonly operationId: string; readonly kind: DriverRootKind }
export interface DriverRootRef { readonly recordId: string; readonly digest: string }
export type DriverRootResult = {
  readonly contractVersion: "cop-driver-origin-result-v1";
  readonly operationId: string;
} & ({ readonly state: "pending"; readonly reason: "origin-busy" | "origin-unresolved" | "store-unavailable" |
  "authority-unavailable" | "transport-unavailable" | "effect-observation-unavailable" } |
  { readonly state: "origin-commit-known"; readonly sqlOutcomeRef: DriverRootRef;
    readonly effectQuiescenceRef: DriverRootRef; readonly revokeEffect?: { readonly deletedBatchCount: number } } |
  { readonly state: "origin-no-effects-closed"; readonly sqlOutcomeRef: DriverRootRef;
    readonly effectQuiescenceRef: DriverRootRef; readonly revokeEffect?: never });
/** Internal only; no ordinary HTTP input may select this operation reference. */
export interface DriverRootPort {
  execute(request: { readonly operation: DriverRootOperation; readonly body: object }): Promise<DriverRootResult>;
  /** This is a mutating resolver/sealer, never a read-only status operation. */
  probe(operation: DriverRootOperation): Promise<DriverRootResult>;
}
/** Fixed Root-owned module/keyring/socket. No user-selected transport or verifier. */
export function createProductionDriverRootPort(): DriverRootPort;
export function main(): Promise<void>;

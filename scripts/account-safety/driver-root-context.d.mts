export interface DriverRootHttpScope {
  readonly method: string;
  readonly path: string;
  readonly authorization: string;
  readonly actor: string;
  readonly actorSignature: string;
  readonly body: unknown;
}
export interface DriverRequestOperationContext {
  readonly operation: { readonly operationId: string; readonly kind: "revoke" | "erase" | "ack" };
  readonly publicationContext?: { readonly contractVersion: "cop-driver-publication-context-v1"; readonly recordId: string;
    readonly recordDigest: string; readonly storeIncarnation: string; readonly operationDigest: string; readonly readbackDigest: string;
    readonly reportProtection: "no_report" | "enforced_single_writer" | "shared_generation_fence"; readonly observedAtUTC: string };
}
/** Fixed protected native transport, per invocation ALS and actual signed Root
 * delivery. Factory has no app-selected Root origin/transport/verifier inputs. */
export function createProductionDriverRequestScope(): {
  readonly context: { current(kind: "revoke" | "erase" | "ack"): Promise<DriverRequestOperationContext | undefined> };
  run<T>(scope: DriverRootHttpScope, work: () => T): T;
};

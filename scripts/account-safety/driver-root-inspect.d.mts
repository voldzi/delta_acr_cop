type DriverReadBase = { readonly owner: "sim_driver_measurements"; readonly scope: "online_driver_scope" };
export type DriverRootReadRequest = DriverReadBase & (
  { readonly purpose: "capability" | "intake" } |
  { readonly purpose: "preflight" | "status" | "receipt"; readonly operationHash: string; readonly actorHash: string }
);
export type DriverRootReadAdmission = DriverRootReadRequest & {
  readonly contractVersion: "sim-driver-guarded-read-admission-v1";
  readonly checkpointHash: string;
  readonly reportProtection: "no_report" | "enforced_single_writer" | "shared_generation_fence";
  readonly reference: { readonly recordId: string; readonly digest: string };
};
/** Fixed Root native module/keyring/socket. No injected transport or verifier. */
export function createProductionDriverReadAdmissionPort(): {
  inspect(request: DriverRootReadRequest): Promise<DriverRootReadAdmission | undefined>;
};

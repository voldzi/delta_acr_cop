export interface DriverRootRetentionContext {
  readonly owner: "sim_driver_measurements";
  readonly cutoff: string;
  readonly operation: { readonly operationId: string; readonly kind: "expire" };
}
/** No application-selected origin, cutoff, credential or positive verifier. */
export function createProductionDriverRetentionConsumer(): {
  readonly owner: "sim_driver_measurements";
  execute(work: (context: DriverRootRetentionContext) => Promise<void>): Promise<void>;
};

export interface DriverPublicationLease { assertCurrent(): Promise<void> }
export interface DriverPublicationPort {
  withLease<T>(input: { readonly kind: "aggregates" | "quality" }, work: (lease: DriverPublicationLease) => Promise<T>): Promise<T>;
}
export function createProductionDriverPublicationPort(): DriverPublicationPort;

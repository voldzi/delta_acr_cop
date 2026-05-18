import type { CanonicalEventEnvelope } from "@cop/canonical-model";

export interface SourceAdapter {
  adapterId: string;
  adapterVersion: string;
  normalize(input: unknown): CanonicalEventEnvelope;
}

export class SimulationAdapter implements SourceAdapter {
  adapterId = "simulation-adapter";
  adapterVersion = "1.0.0";

  normalize(input: unknown): CanonicalEventEnvelope {
    const event = input as CanonicalEventEnvelope;
    return {
      ...event,
      source: {
        ...event.source,
        adapterId: event.source.adapterId || this.adapterId,
        adapterVersion: event.source.adapterVersion || this.adapterVersion
      },
      simulation: {
        synthetic: true,
        ...event.simulation
      }
    };
  }
}

export function getDefaultAdapters(): SourceAdapter[] {
  return [new SimulationAdapter()];
}

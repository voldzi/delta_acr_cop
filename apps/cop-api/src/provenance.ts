import type { CanonicalEventEnvelope, ObservedObject } from "@cop/canonical-model";

export interface ObjectProvenance {
  adapterId?: string;
  adapterVersion?: string;
  eventId?: string;
  informationCredibility?: string;
  ingestTimestamp?: string;
  latencyMs?: number;
  producerTimestamp?: string;
  sourceDeviceId?: string | null;
  sourceReliability?: string;
  sourceSystemId?: string;
  synthetic?: boolean;
}

export function withEventProvenance(object: ObservedObject, event: CanonicalEventEnvelope): ObservedObject {
  const producerMs = Date.parse(event.producerTimestamp);
  const ingestTimestamp = event.ingestTimestamp ?? object.lastUpdatedAt;
  const ingestMs = ingestTimestamp ? Date.parse(ingestTimestamp) : Number.NaN;
  const latencyMs = Number.isFinite(producerMs) && Number.isFinite(ingestMs) ? Math.max(0, ingestMs - producerMs) : undefined;

  return withObjectProvenance(object, {
    adapterId: event.source.adapterId,
    adapterVersion: event.source.adapterVersion,
    eventId: event.eventId,
    informationCredibility: event.quality.informationCredibility,
    ...(ingestTimestamp ? { ingestTimestamp } : {}),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    producerTimestamp: event.producerTimestamp,
    sourceDeviceId: event.source.sourceDeviceId,
    sourceReliability: event.quality.sourceReliability,
    sourceSystemId: event.source.sourceSystemId,
    synthetic: event.simulation?.synthetic ?? false
  });
}

export function withStoredCurrentProvenance(
  object: ObservedObject,
  stored: {
    eventId: string;
    lastUpdatedAt: string;
    sourceSystemId: string;
    synthetic: boolean;
  }
): ObservedObject {
  const existing = readObjectProvenance(object);
  return withObjectProvenance(object, {
    ...existing,
    eventId: existing?.eventId ?? stored.eventId,
    ingestTimestamp: existing?.ingestTimestamp ?? object.lastUpdatedAt ?? stored.lastUpdatedAt,
    sourceSystemId: existing?.sourceSystemId ?? stored.sourceSystemId,
    synthetic: existing?.synthetic ?? stored.synthetic
  });
}

export function readObjectProvenance(object: ObservedObject): ObjectProvenance | undefined {
  const attributes = object.attributes;
  if (!attributes || typeof attributes.provenance !== "object" || attributes.provenance === null || Array.isArray(attributes.provenance)) {
    return undefined;
  }
  return attributes.provenance as ObjectProvenance;
}

function withObjectProvenance(object: ObservedObject, provenance: ObjectProvenance): ObservedObject {
  return {
    ...object,
    attributes: {
      ...(object.attributes ?? {}),
      provenance
    }
  };
}

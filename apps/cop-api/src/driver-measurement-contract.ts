import { createHmac } from "node:crypto";
import { z } from "zod";

export const DRIVER_MEASUREMENT_MOBILE_VERSION = "cop-driver-measurements-v1";
export const DRIVER_MEASUREMENT_SIM_VERSION = "sim-driver-measurements-v1";
export const DRIVER_MEASUREMENT_CONSENT_VERSION = "traffic-quality-v1";

const uuid = z.uuid();
const utcTimestamp = z.iso.datetime({ offset: false });
const pointSchema = z.strictObject({
  sampleId: uuid,
  observedAt: utcTimestamp,
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  horizontalAccuracyM: z.number().finite().min(0).max(15),
  speedMps: z.number().finite().min(0).max(70),
  speedAccuracyMps: z.number().finite().min(0).max(2),
  headingDeg: z.number().finite().min(0).lt(360),
  headingAccuracyDeg: z.number().finite().min(0).max(20),
  positionSource: z.literal("gps"),
  motion: z.enum(["driving", "traffic_stop"]),
  reducedAccuracy: z.literal(false)
});

const etaSchema = z.strictObject({
  observationId: uuid,
  routingDataset: z.string().regex(/^sim-routing-\d{4}-\d{2}-\d{2}-\d+$/),
  predictedDurationSeconds: z.number().finite().min(1).max(86400),
  actualDurationSeconds: z.number().finite().min(1).max(86400),
  plannedDistanceM: z.number().finite().min(100).max(2_000_000),
  actualDistanceM: z.number().finite().min(100).max(2_000_000),
  personalStopSeconds: z.number().finite().min(0).max(86400),
  estimatedSeconds: z.number().finite().min(0).max(86400),
  offRoute: z.boolean(),
  completedAt: utcTimestamp
}).refine((eta) => eta.personalStopSeconds + eta.estimatedSeconds <= eta.actualDurationSeconds);

export const mobileBatchSchema = z.strictObject({
  contractVersion: z.literal(DRIVER_MEASUREMENT_MOBILE_VERSION),
  batchId: uuid,
  contributorDay: z.iso.date(),
  vehicleClass: z.literal("passenger_car"),
  points: z.array(pointSchema).min(3).max(120),
  eta: etaSchema.optional()
});

export type MobileDriverBatch = z.infer<typeof mobileBatchSchema>;
export interface DriverConsent { grantedAt: string | null; lastRevokedDay: string | null; pendingDays: string[]; revokedAt: string | null }

export function validateMobileBatch(value: unknown, consent: DriverConsent, now: Date): MobileDriverBatch | null {
  const parsed = mobileBatchSchema.safeParse(value);
  if (!parsed.success || !consent.grantedAt || consent.revokedAt) return null;
  const batch = parsed.data;
  const nowMs = now.getTime();
  const grantedMs = Date.parse(consent.grantedAt);
  const seen = new Set<string>();
  let previous = -Infinity;
  for (const point of batch.points) {
    const timestamp = Date.parse(point.observedAt);
    if (point.observedAt.slice(0, 10) !== batch.contributorDay ||
        timestamp < grantedMs || timestamp > nowMs - 60_000 || timestamp < nowMs - 86_400_000 ||
        timestamp <= previous || seen.has(point.sampleId)) return null;
    if (previous !== -Infinity && (timestamp - previous < 1_000 || timestamp - previous > 10_000)) return null;
    seen.add(point.sampleId);
    previous = timestamp;
  }
  if (previous - Date.parse(batch.points[0]!.observedAt) > 600_000) return null;
  if (batch.eta) {
    const completed = Date.parse(batch.eta.completedAt);
    if (completed < grantedMs || completed > nowMs + 30_000 || completed < nowMs - 86_400_000 ||
        batch.eta.completedAt.slice(0, 10) !== batch.contributorDay) return null;
  }
  return batch;
}

export function contributorIdDay(secret: string, subjectId: string, day: string): string {
  return createHmac("sha256", secret).update(`cop-driver-contributor-v1\0${subjectId}\0${day}`).digest("base64url");
}

export function scopedUuid(secret: string, subjectId: string, day: string, kind: string, clientId: string): string {
  const bytes = createHmac("sha256", secret)
    .update(`cop-driver-${kind}-v1\0${subjectId}\0${day}\0${clientId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function toSimBatch(batch: MobileDriverBatch, consent: DriverConsent, subjectId: string, secret: string): Record<string, unknown> {
  const day = batch.contributorDay;
  return {
    contractVersion: DRIVER_MEASUREMENT_SIM_VERSION,
    batchId: scopedUuid(secret, subjectId, day, "batch", batch.batchId),
    contributorIdDay: contributorIdDay(secret, subjectId, day),
    contributorDay: day,
    consent: { version: DRIVER_MEASUREMENT_CONSENT_VERSION, grantedAt: consent.grantedAt, attestation: "cop-driver-consent-v1" },
    vehicleClass: batch.vehicleClass,
    points: batch.points.map((point) => ({ ...point, sampleId: scopedUuid(secret, subjectId, day, "sample", point.sampleId) })),
    ...(batch.eta ? { eta: { ...batch.eta, observationId: scopedUuid(secret, subjectId, day, "eta", batch.eta.observationId) } } : {})
  };
}

export function deletionDays(now: Date): string[] {
  return Array.from({ length: 9 }, (_, offset) => new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10));
}

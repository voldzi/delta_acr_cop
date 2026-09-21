import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { RoutingSource } from "./routing-source.js";

export interface RoadEnrichment {
  contractVersion: "cop-road-enrichment-v1";
  state: "matched" | "ambiguous" | "unavailable" | "expired";
  enrichedAt: string;
  routingDataset?: string;
  directedEdgeId?: string;
  clusterId?: string;
  reason: string;
}

export interface RoadEnrichmentJob {
  reportId: string;
  version: number;
  lease: string;
  attempts: number;
  lat: number;
  lon: number;
  accuracyM?: number;
  observedAt: string;
  properties: Record<string, unknown>;
}

export interface RoadEnrichmentQueue {
  claim(now: Date): Promise<RoadEnrichmentJob[]>;
  complete(job: RoadEnrichmentJob, result: RoadEnrichment): Promise<void>;
  retry(job: RoadEnrichmentJob, now: Date): Promise<void>;
}

/** Presentation groups only the already-authorized result set; original records remain intact. */
export function groupRoadObservations<T extends { reportId: string; observedAt: string; roadEnrichment?: RoadEnrichment }>(
  reports: T[], canGroup: (report: T) => boolean
): Array<{ report: T; count: number }> {
  const groups = new Map<string, { report: T; count: number }>();
  for (const report of reports) {
    const cluster = canGroup(report) && report.roadEnrichment?.state === "matched" ? report.roadEnrichment.clusterId : undefined;
    const key = cluster ? `cluster:${cluster}` : `report:${report.reportId}`;
    const existing = groups.get(key);
    if (!existing) groups.set(key, { report, count: 1 });
    else {
      existing.count += 1;
      if (report.observedAt > existing.report.observedAt) existing.report = report;
    }
  }
  return [...groups.values()];
}

export const roadEnrichmentSchema = `
ALTER TABLE cop_community_reports ADD COLUMN IF NOT EXISTS road_enrichment jsonb,
  ADD COLUMN IF NOT EXISTS road_enrichment_version integer;
CREATE TABLE IF NOT EXISTS cop_community_report_enrichment_jobs (
  report_id uuid PRIMARY KEY REFERENCES cop_community_reports(report_id) ON DELETE CASCADE,
  report_version integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  lease_id uuid,
  leased_until timestamptz
);
CREATE INDEX IF NOT EXISTS cop_report_enrichment_due_idx ON cop_community_report_enrichment_jobs (next_attempt_at);
CREATE INDEX IF NOT EXISTS cop_report_enrichment_edge_idx
  ON cop_community_reports ((road_enrichment->>'routingDataset'), (road_enrichment->>'directedEdgeId'))
  WHERE road_enrichment IS NOT NULL;
`;

export class PostgresRoadEnrichmentQueue implements RoadEnrichmentQueue {
  constructor(private readonly pool: Pool) {}

  async claim(now: Date): Promise<RoadEnrichmentJob[]> {
    await this.pool.query(`DELETE FROM cop_community_report_enrichment_jobs j USING cop_community_reports r
      WHERE r.report_id=j.report_id AND (r.status NOT IN ('submitted','published')
        OR r.observed_at <= $1::timestamptz - interval '24 hours')`, [now.toISOString()]);
    // Durable reconciliation catches a crash immediately after report submission and
    // every changed report version. The report store remains the source of truth.
    await this.pool.query(`INSERT INTO cop_community_report_enrichment_jobs (report_id, report_version, next_attempt_at)
      SELECT report_id, version, $1::timestamptz FROM cop_community_reports r
      WHERE status IN ('submitted', 'published') AND observed_at > $1::timestamptz - interval '24 hours'
        AND category IN ('traffic_accident','traffic_congestion','stopped_vehicle','road_blockage','dangerous_weather','hazard')
        AND road_enrichment_version IS DISTINCT FROM version
        AND NOT EXISTS (SELECT 1 FROM cop_community_report_enrichment_jobs j
          WHERE j.report_id=r.report_id AND j.report_version=r.version)
      ORDER BY updated_at LIMIT 100
      ON CONFLICT (report_id) DO UPDATE SET report_version=EXCLUDED.report_version, attempts=0,
        next_attempt_at=EXCLUDED.next_attempt_at, lease_id=NULL, leased_until=NULL
      WHERE cop_community_report_enrichment_jobs.report_version <> EXCLUDED.report_version`, [now.toISOString()]);
    const lease = randomUUID();
    const result = await this.pool.query(`WITH due AS (
      SELECT report_id FROM cop_community_report_enrichment_jobs
      WHERE next_attempt_at <= $1::timestamptz AND (leased_until IS NULL OR leased_until <= $1::timestamptz)
      ORDER BY next_attempt_at LIMIT 2 FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE cop_community_report_enrichment_jobs j SET lease_id=$2, leased_until=$1::timestamptz + interval '120 seconds', attempts=attempts+1
      FROM due WHERE j.report_id=due.report_id RETURNING j.*
    ) SELECT c.*, r.lat, r.lon, r.location_accuracy_m, r.observed_at, r.properties
      FROM claimed c JOIN cop_community_reports r ON r.report_id=c.report_id`, [now.toISOString(), lease]);
    return result.rows.map(row => ({ reportId: row.report_id, version: row.report_version, lease,
      attempts: row.attempts, lat: Number(row.lat), lon: Number(row.lon),
      accuracyM: row.location_accuracy_m == null ? undefined : Number(row.location_accuracy_m),
      observedAt: new Date(row.observed_at).toISOString(), properties: row.properties ?? {} }));
  }

  async complete(job: RoadEnrichmentJob, result: RoadEnrichment): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let clusterId: string | undefined;
      if (result.state === "matched") {
        // Serialize clustering for this dataset + directed edge across API replicas.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${result.routingDataset}:${result.directedEdgeId}`
        ]);
        const peer = await client.query(`SELECT other.road_enrichment->>'clusterId' AS cluster_id
          FROM cop_community_reports r JOIN cop_community_reports other ON other.report_id <> r.report_id
          WHERE r.report_id=$1 AND other.status IN ('submitted','published')
            AND other.road_enrichment_version=other.version AND other.category=r.category
            AND ((r.visibility='public' AND other.visibility='public') OR
              (r.subject_id=other.subject_id AND r.visibility=other.visibility))
            AND other.road_enrichment->>'routingDataset'=$2 AND other.road_enrichment->>'directedEdgeId'=$3
            AND other.road_enrichment->>'clusterId' IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM (other.observed_at-r.observed_at))) <= 600
            AND ST_DistanceSphere(other.location_geom, r.location_geom) <= 50
          ORDER BY other.observed_at, other.report_id LIMIT 1`, [job.reportId, result.routingDataset, result.directedEdgeId]);
        clusterId = peer.rows[0]?.cluster_id ?? randomUUID();
      }
      await client.query(`UPDATE cop_community_reports r SET road_enrichment=$4::jsonb, road_enrichment_version=$2
        WHERE report_id=$1 AND version=$2 AND status IN ('submitted','published')
        AND EXISTS (SELECT 1 FROM cop_community_report_enrichment_jobs j WHERE j.report_id=r.report_id
          AND j.report_version=$2 AND j.lease_id=$3)`, [job.reportId, job.version, job.lease, JSON.stringify({ ...result, ...(clusterId ? { clusterId } : {}) })]);
      await client.query("DELETE FROM cop_community_report_enrichment_jobs WHERE report_id=$1 AND report_version=$2 AND lease_id=$3", [job.reportId, job.version, job.lease]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async retry(job: RoadEnrichmentJob, now: Date): Promise<void> {
    const delaySeconds = Math.min(3600, 15 * 2 ** Math.min(job.attempts, 8));
    await this.pool.query(`UPDATE cop_community_report_enrichment_jobs SET lease_id=NULL, leased_until=NULL,
      next_attempt_at=$4::timestamptz WHERE report_id=$1 AND report_version=$2 AND lease_id=$3`,
    [job.reportId, job.version, job.lease, new Date(now.getTime() + delaySeconds * 1000).toISOString()]);
  }
}

export function roadMatchRequest(job: RoadEnrichmentJob, now: Date): Record<string, unknown> | null {
  const expires = typeof job.properties.validUntil === "string" ? Date.parse(job.properties.validUntil) : NaN;
  if (Number.isFinite(expires) && expires <= now.getTime()) return null;
  const context = job.properties.roadContext as Record<string, unknown> | undefined;
  const heading = context?.travelDirectionDeg;
  const speed = context?.speedMps;
  const directionIsReliable = typeof heading === "number" && heading >= 0 && heading < 360 &&
    typeof speed === "number" && speed >= 2 && speed <= 100 &&
    typeof job.accuracyM === "number" && job.accuracyM >= 0 && job.accuracyM <= 30;
  return { profileId: "car", point: { lat: job.lat, lon: job.lon }, radiusM: 50, includeRoadMatch: true,
    ...(directionIsReliable ? { headingDeg: heading } : {}) };
}

export function normalizeRoadMatch(value: unknown, now: Date): RoadEnrichment {
  const base = { contractVersion: "cop-road-enrichment-v1" as const, enrichedAt: now.toISOString() };
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>).roadMatch : undefined;
  if (!raw || typeof raw !== "object") throw new Error("ROAD_MATCH_UNAVAILABLE");
  const data = raw as Record<string, unknown>;
  if (data.contractVersion !== "sim-road-match-v1") throw new Error("ROAD_MATCH_CONTRACT_UNSUPPORTED");
  const matchedAt = typeof data.matchedAt === "string" ? Date.parse(data.matchedAt) : NaN;
  if (!Number.isFinite(matchedAt) || now.getTime() - matchedAt > 600_000 || matchedAt - now.getTime() > 60_000) {
    throw new Error("ROAD_MATCH_STALE");
  }
  if (data.state === "ambiguous") return { ...base, state: "ambiguous", reason: "direction_or_road_ambiguous" };
  if (data.state === "unavailable") throw new Error("ROAD_MATCH_UNAVAILABLE");
  const candidate = data.candidate as Record<string, unknown> | undefined;
  if (data.state !== "matched" || typeof data.routingDataset !== "string" || !data.routingDataset.startsWith("sim-routing-") ||
      typeof candidate?.directedEdgeId !== "string" || !/^\d+$/.test(candidate.directedEdgeId) ||
      typeof candidate.distanceM !== "number" || !Number.isFinite(candidate.distanceM) || candidate.distanceM < 0 || candidate.distanceM > 50) throw new Error("ROAD_MATCH_INVALID");
  return { ...base, state: "matched", routingDataset: data.routingDataset,
    directedEdgeId: candidate.directedEdgeId, reason: "provider_directional_match_requires_review" };
}

export class RoadEnrichmentRunner {
  private timer?: ReturnType<typeof setInterval>;
  private flight?: Promise<void>;
  private stopped = false;
  failed = false;
  constructor(private readonly queue: RoadEnrichmentQueue, private readonly source: RoutingSource) {}

  start(): void {
    this.timer = setInterval(() => { void this.tick(); }, 15_000);
    this.timer.unref?.();
  }

  async tick(now = new Date()): Promise<void> {
    if (this.flight || this.stopped) return;
    this.flight = this.run(now).catch(() => { this.failed = true; });
    try { await this.flight; } finally { this.flight = undefined; }
  }

  private async run(now: Date): Promise<void> {
    const jobs = await this.queue.claim(now);
    if (jobs.length > 0) this.failed = false;
    for (const job of jobs) {
      if (this.stopped) break;
      try {
        const request = roadMatchRequest(job, now);
        const result: RoadEnrichment = request
          ? normalizeRoadMatch(await this.source.nearestAccess(request, now), now)
          : { contractVersion: "cop-road-enrichment-v1", state: "expired", enrichedAt: now.toISOString(), reason: "observation_expired" };
        await this.queue.complete(job, result);
      } catch {
        this.failed = true;
        await this.queue.retry(job, now);
      }
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.flight;
  }
}

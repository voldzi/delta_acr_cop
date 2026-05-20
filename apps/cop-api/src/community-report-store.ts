import pg, { type Pool as PgPool, type PoolConfig, type QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;

export type CommunityReportCategory =
  | "fire"
  | "flood"
  | "bridge_damage"
  | "road_blockage"
  | "infrastructure_damage"
  | "medical"
  | "utility_outage"
  | "hazard"
  | "other";

export type CommunityReportStatus = "draft" | "submitted" | "published" | "hidden" | "rejected";
export type CommunityReportVisibility = "private" | "community" | "public";
export type CommunityLocationSource = "device" | "manual" | "photo_exif" | "unknown";
export type CommunityAttachmentKind = "photo" | "video" | "document";
export type CommunityAttachmentStatus = "pending_upload" | "uploaded" | "failed" | "removed";

export interface CommunityReportLocation {
  accuracyM?: number;
  lat: number;
  lon: number;
  source: CommunityLocationSource;
}

export interface CommunityReportActor {
  displayName: string;
  subjectId: string;
  username: string;
}

export interface CommunityReportAttachmentRecord {
  attachmentId: string;
  bucket: string;
  byteSize: number;
  capturedAt?: string;
  captureLocation?: CommunityReportLocation;
  checksumSha256?: string;
  contentType: string;
  createdAt: string;
  fileName?: string;
  kind: CommunityAttachmentKind;
  metadata: Record<string, unknown>;
  objectKey: string;
  reportId: string;
  status: CommunityAttachmentStatus;
  subjectId: string;
  uploadedAt?: string;
  uploadExpiresAt: string;
}

export interface CommunityReportRecord {
  attachments: CommunityReportAttachmentRecord[];
  category: CommunityReportCategory;
  createdAt: string;
  createdBy: CommunityReportActor;
  description?: string;
  location: CommunityReportLocation;
  observedAt: string;
  properties: Record<string, unknown>;
  publishedAt?: string;
  reportId: string;
  status: CommunityReportStatus;
  submittedAt?: string;
  title: string;
  updatedAt: string;
  visibility: CommunityReportVisibility;
}

export interface CreateCommunityReportInput {
  category: CommunityReportCategory;
  createdBy: CommunityReportActor;
  description?: string;
  location: CommunityReportLocation;
  observedAt: string;
  properties?: Record<string, unknown>;
  title: string;
  visibility: CommunityReportVisibility;
}

export interface CreateCommunityAttachmentInput {
  attachmentId: string;
  bucket: string;
  byteSize: number;
  capturedAt?: string;
  captureLocation?: CommunityReportLocation;
  checksumSha256?: string;
  contentType: string;
  fileName?: string;
  kind: CommunityAttachmentKind;
  metadata?: Record<string, unknown>;
  objectKey: string;
  reportId: string;
  subjectId: string;
  uploadExpiresAt: string;
}

export interface CompleteCommunityAttachmentInput {
  attachmentId: string;
  byteSize?: number;
  checksumSha256?: string;
  completedAt: string;
  reportId: string;
  subjectId: string;
}

export interface CommunityReportQuery {
  bbox?: {
    east: number;
    north: number;
    south: number;
    west: number;
  };
  categories?: CommunityReportCategory[];
  includeOwnDrafts?: boolean;
  limit?: number;
  statuses?: CommunityReportStatus[];
  subjectId?: string;
}

export interface CommunityReportStore {
  readonly name: string;
  close(): Promise<void>;
  completeAttachment(input: CompleteCommunityAttachmentInput): Promise<CommunityReportAttachmentRecord | null>;
  createAttachment(input: CreateCommunityAttachmentInput): Promise<CommunityReportAttachmentRecord>;
  createReport(input: CreateCommunityReportInput, now: Date): Promise<CommunityReportRecord>;
  diagnostics?(): string | undefined;
  getReport(reportId: string): Promise<CommunityReportRecord | null>;
  init(): Promise<void>;
  listReports(query: CommunityReportQuery): Promise<CommunityReportRecord[]>;
  submitReport(reportId: string, subjectId: string, now: Date): Promise<CommunityReportRecord | null>;
}

export function createCommunityReportStoreFromEnv(env: Record<string, string | undefined> = process.env): CommunityReportStore | undefined {
  const mode = (env.COP_COMMUNITY_REPORT_STORE ?? "auto").trim().toLowerCase();
  const connectionString = env.COP_DATABASE_URL?.trim();

  if (mode === "disabled" || mode === "off") {
    return undefined;
  }
  if (mode === "memory" || (mode === "auto" && !connectionString)) {
    return new InMemoryCommunityReportStore(mode === "memory" ? "memory" : "memory-auto");
  }
  if ((mode === "auto" || mode === "postgres" || mode === "postgresql") && connectionString) {
    return new PostgresCommunityReportStore({
      connectionString,
      connectionTimeoutMillis: readPositiveInteger(env.COP_DATABASE_CONNECT_TIMEOUT_MS, 5000),
      idleTimeoutMillis: readPositiveInteger(env.COP_DATABASE_IDLE_TIMEOUT_MS, 30000),
      max: readPositiveInteger(env.COP_DATABASE_POOL_MAX, 5),
      ssl: readSslConfig(env)
    });
  }

  throw new Error(`Unsupported COP_COMMUNITY_REPORT_STORE value: ${mode}`);
}

export class InMemoryCommunityReportStore implements CommunityReportStore {
  readonly name: string;
  private readonly attachments = new Map<string, CommunityReportAttachmentRecord>();
  private readonly reports = new Map<string, CommunityReportRecord>();

  constructor(name = "memory") {
    this.name = name;
  }

  async init(): Promise<void> {}

  async createReport(input: CreateCommunityReportInput, now: Date): Promise<CommunityReportRecord> {
    const timestamp = now.toISOString();
    const report: CommunityReportRecord = {
      attachments: [],
      category: input.category,
      createdAt: timestamp,
      createdBy: input.createdBy,
      ...(input.description ? { description: input.description } : {}),
      location: input.location,
      observedAt: input.observedAt,
      properties: input.properties ?? {},
      reportId: randomUUID(),
      status: "draft",
      title: input.title,
      updatedAt: timestamp,
      visibility: input.visibility
    };
    this.reports.set(report.reportId, report);
    return report;
  }

  async getReport(reportId: string): Promise<CommunityReportRecord | null> {
    const report = this.reports.get(reportId);
    return report ? { ...report, attachments: this.attachmentsForReport(reportId) } : null;
  }

  async listReports(query: CommunityReportQuery): Promise<CommunityReportRecord[]> {
    return Array.from(this.reports.values())
      .filter((report) => matchesCommunityQuery(report, query))
      .sort(compareReports)
      .slice(0, resolveLimit(query.limit))
      .map((report) => ({ ...report, attachments: this.attachmentsForReport(report.reportId) }));
  }

  async submitReport(reportId: string, subjectId: string, now: Date): Promise<CommunityReportRecord | null> {
    const report = this.reports.get(reportId);
    if (!report || report.createdBy.subjectId !== subjectId) {
      return null;
    }
    const timestamp = now.toISOString();
    const updated: CommunityReportRecord = {
      ...report,
      status: report.status === "draft" ? "submitted" : report.status,
      submittedAt: report.submittedAt ?? timestamp,
      updatedAt: timestamp
    };
    this.reports.set(reportId, updated);
    return { ...updated, attachments: this.attachmentsForReport(reportId) };
  }

  async createAttachment(input: CreateCommunityAttachmentInput): Promise<CommunityReportAttachmentRecord> {
    const timestamp = new Date().toISOString();
    const attachment: CommunityReportAttachmentRecord = {
      attachmentId: input.attachmentId,
      bucket: input.bucket,
      byteSize: input.byteSize,
      ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
      ...(input.captureLocation ? { captureLocation: input.captureLocation } : {}),
      ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
      contentType: input.contentType,
      createdAt: timestamp,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      kind: input.kind,
      metadata: input.metadata ?? {},
      objectKey: input.objectKey,
      reportId: input.reportId,
      status: "pending_upload",
      subjectId: input.subjectId,
      uploadExpiresAt: input.uploadExpiresAt
    };
    this.attachments.set(input.attachmentId, attachment);
    return attachment;
  }

  async completeAttachment(input: CompleteCommunityAttachmentInput): Promise<CommunityReportAttachmentRecord | null> {
    const attachment = this.attachments.get(input.attachmentId);
    if (!attachment || attachment.reportId !== input.reportId || attachment.subjectId !== input.subjectId) {
      return null;
    }
    const updated: CommunityReportAttachmentRecord = {
      ...attachment,
      ...(input.byteSize ? { byteSize: input.byteSize } : {}),
      ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
      status: "uploaded",
      uploadedAt: input.completedAt
    };
    this.attachments.set(input.attachmentId, updated);
    return updated;
  }

  async close(): Promise<void> {}

  private attachmentsForReport(reportId: string): CommunityReportAttachmentRecord[] {
    return Array.from(this.attachments.values())
      .filter((attachment) => attachment.reportId === reportId && attachment.status !== "removed")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
}

export class PostgresCommunityReportStore implements CommunityReportStore {
  readonly name = "postgres";
  private lastIdleClientError: string | undefined;
  private readonly pool: PgPool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
    this.pool.on("error", (error) => {
      this.lastIdleClientError = errorMessage(error);
    });
  }

  async init(): Promise<void> {
    await this.pool.query(createCommunityReportTablesSql);
  }

  async createReport(input: CreateCommunityReportInput, now: Date): Promise<CommunityReportRecord> {
    const result = await this.pool.query<CommunityReportRow>(
      `INSERT INTO cop_community_reports (
        report_id,
        subject_id,
        username,
        display_name,
        category,
        title,
        description,
        status,
        visibility,
        lat,
        lon,
        location_accuracy_m,
        location_source,
        observed_at,
        properties,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11, $12, $13::timestamptz, $14::jsonb, $15::timestamptz, $15::timestamptz
      )
      RETURNING *`,
      [
        randomUUID(),
        input.createdBy.subjectId,
        input.createdBy.username,
        input.createdBy.displayName,
        input.category,
        input.title,
        input.description ?? null,
        input.visibility,
        input.location.lat,
        input.location.lon,
        input.location.accuracyM ?? null,
        input.location.source,
        input.observedAt,
        JSON.stringify(input.properties ?? {}),
        now.toISOString()
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Community report insert returned no row.");
    }
    return reportFromRow(row, []);
  }

  async getReport(reportId: string): Promise<CommunityReportRecord | null> {
    const result = await this.pool.query<CommunityReportRow>("SELECT * FROM cop_community_reports WHERE report_id = $1", [reportId]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return reportFromRow(row, await this.attachmentsForReports([reportId]));
  }

  async listReports(query: CommunityReportQuery): Promise<CommunityReportRecord[]> {
    const params: unknown[] = [];
    const clauses = buildCommunityQueryClauses(query, params);
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitParam = addParam(params, resolveLimit(query.limit));
    const result = await this.pool.query<CommunityReportRow>(
      `SELECT *
      FROM cop_community_reports
      ${whereClause}
      ORDER BY observed_at DESC, created_at DESC
      LIMIT ${limitParam}`,
      params
    );
    const attachments = await this.attachmentsForReports(result.rows.map((row) => row.report_id));
    return result.rows.map((row) => reportFromRow(row, attachments));
  }

  async submitReport(reportId: string, subjectId: string, now: Date): Promise<CommunityReportRecord | null> {
    const result = await this.pool.query<CommunityReportRow>(
      `UPDATE cop_community_reports
      SET
        status = CASE WHEN status = 'draft' THEN 'submitted' ELSE status END,
        submitted_at = COALESCE(submitted_at, $3::timestamptz),
        updated_at = $3::timestamptz
      WHERE report_id = $1 AND subject_id = $2
      RETURNING *`,
      [reportId, subjectId, now.toISOString()]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return reportFromRow(row, await this.attachmentsForReports([reportId]));
  }

  async createAttachment(input: CreateCommunityAttachmentInput): Promise<CommunityReportAttachmentRecord> {
    const result = await this.pool.query<CommunityAttachmentRow>(
      `INSERT INTO cop_community_report_attachments (
        attachment_id,
        report_id,
        subject_id,
        kind,
        status,
        bucket,
        object_key,
        content_type,
        byte_size,
        checksum_sha256,
        original_filename,
        captured_at,
        capture_lat,
        capture_lon,
        capture_accuracy_m,
        capture_location_source,
        upload_expires_at,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, 'pending_upload', $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, $14, $15, $16::timestamptz, $17::jsonb
      )
      RETURNING *`,
      [
        input.attachmentId,
        input.reportId,
        input.subjectId,
        input.kind,
        input.bucket,
        input.objectKey,
        input.contentType,
        input.byteSize,
        input.checksumSha256 ?? null,
        input.fileName ?? null,
        input.capturedAt ?? null,
        input.captureLocation?.lat ?? null,
        input.captureLocation?.lon ?? null,
        input.captureLocation?.accuracyM ?? null,
        input.captureLocation?.source ?? null,
        input.uploadExpiresAt,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Community attachment insert returned no row.");
    }
    return attachmentFromRow(row);
  }

  async completeAttachment(input: CompleteCommunityAttachmentInput): Promise<CommunityReportAttachmentRecord | null> {
    const result = await this.pool.query<CommunityAttachmentRow>(
      `UPDATE cop_community_report_attachments
      SET
        status = 'uploaded',
        byte_size = COALESCE($4, byte_size),
        checksum_sha256 = COALESCE($5, checksum_sha256),
        uploaded_at = $6::timestamptz
      WHERE attachment_id = $1 AND report_id = $2 AND subject_id = $3
      RETURNING *`,
      [
        input.attachmentId,
        input.reportId,
        input.subjectId,
        input.byteSize ?? null,
        input.checksumSha256 ?? null,
        input.completedAt
      ]
    );
    return result.rows[0] ? attachmentFromRow(result.rows[0]) : null;
  }

  diagnostics(): string | undefined {
    return this.lastIdleClientError ? `last idle client error: ${this.lastIdleClientError}` : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async attachmentsForReports(reportIds: string[]): Promise<CommunityReportAttachmentRecord[]> {
    if (reportIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<CommunityAttachmentRow>(
      `SELECT *
      FROM cop_community_report_attachments
      WHERE report_id = ANY($1::uuid[]) AND status <> 'removed'
      ORDER BY created_at ASC`,
      [reportIds]
    );
    return result.rows.map(attachmentFromRow);
  }
}

interface CommunityReportRow extends QueryResultRow {
  category: CommunityReportCategory;
  created_at: Date | string;
  description: string | null;
  display_name: string;
  lat: number | string;
  location_accuracy_m: number | string | null;
  location_source: CommunityLocationSource;
  lon: number | string;
  observed_at: Date | string;
  properties: Record<string, unknown> | string | null;
  published_at: Date | string | null;
  report_id: string;
  status: CommunityReportStatus;
  subject_id: string;
  submitted_at: Date | string | null;
  title: string;
  updated_at: Date | string;
  username: string;
  visibility: CommunityReportVisibility;
}

interface CommunityAttachmentRow extends QueryResultRow {
  attachment_id: string;
  bucket: string;
  byte_size: number | string;
  captured_at: Date | string | null;
  capture_accuracy_m: number | string | null;
  capture_lat: number | string | null;
  capture_location_source: CommunityLocationSource | null;
  capture_lon: number | string | null;
  checksum_sha256: string | null;
  content_type: string;
  created_at: Date | string;
  kind: CommunityAttachmentKind;
  metadata: Record<string, unknown> | string | null;
  object_key: string;
  original_filename: string | null;
  report_id: string;
  status: CommunityAttachmentStatus;
  subject_id: string;
  uploaded_at: Date | string | null;
  upload_expires_at: Date | string;
}

const createCommunityReportTablesSql = `
CREATE TABLE IF NOT EXISTS cop_community_reports (
  report_id uuid PRIMARY KEY,
  subject_id text NOT NULL,
  username text NOT NULL,
  display_name text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL,
  visibility text NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  location_accuracy_m double precision,
  location_source text NOT NULL,
  observed_at timestamptz NOT NULL,
  submitted_at timestamptz,
  published_at timestamptz,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cop_community_reports_status_observed_idx
  ON cop_community_reports (status, observed_at DESC);

CREATE INDEX IF NOT EXISTS cop_community_reports_subject_updated_idx
  ON cop_community_reports (subject_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS cop_community_reports_location_idx
  ON cop_community_reports (lat, lon);

CREATE TABLE IF NOT EXISTS cop_community_report_attachments (
  attachment_id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES cop_community_reports(report_id) ON DELETE CASCADE,
  subject_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  checksum_sha256 text,
  original_filename text,
  captured_at timestamptz,
  capture_lat double precision,
  capture_lon double precision,
  capture_accuracy_m double precision,
  capture_location_source text,
  upload_expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cop_community_attachments_report_idx
  ON cop_community_report_attachments (report_id, created_at ASC);
`;

function reportFromRow(row: CommunityReportRow, attachments: CommunityReportAttachmentRecord[]): CommunityReportRecord {
  const submittedAt = row.submitted_at ? isoString(row.submitted_at) : undefined;
  const publishedAt = row.published_at ? isoString(row.published_at) : undefined;
  const description = row.description ?? undefined;
  const accuracyM = row.location_accuracy_m === null ? undefined : Number(row.location_accuracy_m);
  return {
    attachments: attachments.filter((attachment) => attachment.reportId === row.report_id),
    category: row.category,
    createdAt: isoString(row.created_at),
    createdBy: {
      displayName: row.display_name,
      subjectId: row.subject_id,
      username: row.username
    },
    ...(description ? { description } : {}),
    location: {
      ...(accuracyM === undefined ? {} : { accuracyM }),
      lat: Number(row.lat),
      lon: Number(row.lon),
      source: row.location_source
    },
    observedAt: isoString(row.observed_at),
    properties: jsonRecord(row.properties),
    ...(publishedAt ? { publishedAt } : {}),
    reportId: row.report_id,
    status: row.status,
    ...(submittedAt ? { submittedAt } : {}),
    title: row.title,
    updatedAt: isoString(row.updated_at),
    visibility: row.visibility
  };
}

function attachmentFromRow(row: CommunityAttachmentRow): CommunityReportAttachmentRecord {
  const captureLocation = row.capture_lat === null || row.capture_lon === null
    ? undefined
    : {
        ...(row.capture_accuracy_m === null ? {} : { accuracyM: Number(row.capture_accuracy_m) }),
        lat: Number(row.capture_lat),
        lon: Number(row.capture_lon),
        source: row.capture_location_source ?? "unknown"
      };
  const uploadedAt = row.uploaded_at ? isoString(row.uploaded_at) : undefined;
  const capturedAt = row.captured_at ? isoString(row.captured_at) : undefined;
  return {
    attachmentId: row.attachment_id,
    bucket: row.bucket,
    byteSize: Number(row.byte_size),
    ...(capturedAt ? { capturedAt } : {}),
    ...(captureLocation ? { captureLocation } : {}),
    ...(row.checksum_sha256 ? { checksumSha256: row.checksum_sha256 } : {}),
    contentType: row.content_type,
    createdAt: isoString(row.created_at),
    ...(row.original_filename ? { fileName: row.original_filename } : {}),
    kind: row.kind,
    metadata: jsonRecord(row.metadata),
    objectKey: row.object_key,
    reportId: row.report_id,
    status: row.status,
    subjectId: row.subject_id,
    ...(uploadedAt ? { uploadedAt } : {}),
    uploadExpiresAt: isoString(row.upload_expires_at)
  };
}

function buildCommunityQueryClauses(query: CommunityReportQuery, params: unknown[]): string[] {
  const clauses: string[] = [];
  if (query.statuses && query.statuses.length > 0) {
    clauses.push(`status = ANY(${addParam(params, query.statuses)}::text[])`);
  } else if (query.includeOwnDrafts && query.subjectId) {
    const subjectParam = addParam(params, query.subjectId);
    clauses.push(`(status IN ('submitted', 'published') OR (subject_id = ${subjectParam} AND status = 'draft'))`);
  } else {
    clauses.push("status IN ('submitted', 'published')");
  }
  if (query.categories && query.categories.length > 0) {
    clauses.push(`category = ANY(${addParam(params, query.categories)}::text[])`);
  }
  if (query.bbox) {
    clauses.push(`lon >= ${addParam(params, query.bbox.west)}`);
    clauses.push(`lat >= ${addParam(params, query.bbox.south)}`);
    clauses.push(`lon <= ${addParam(params, query.bbox.east)}`);
    clauses.push(`lat <= ${addParam(params, query.bbox.north)}`);
  }
  return clauses;
}

function matchesCommunityQuery(report: CommunityReportRecord, query: CommunityReportQuery): boolean {
  if (query.statuses && query.statuses.length > 0) {
    if (!query.statuses.includes(report.status)) {
      return false;
    }
  } else if (report.status !== "submitted" && report.status !== "published") {
    if (!query.includeOwnDrafts || report.createdBy.subjectId !== query.subjectId || report.status !== "draft") {
      return false;
    }
  }
  if (query.categories && query.categories.length > 0 && !query.categories.includes(report.category)) {
    return false;
  }
  if (query.bbox) {
    const { lat, lon } = report.location;
    if (lon < query.bbox.west || lon > query.bbox.east || lat < query.bbox.south || lat > query.bbox.north) {
      return false;
    }
  }
  return true;
}

function compareReports(left: CommunityReportRecord, right: CommunityReportRecord): number {
  return right.observedAt.localeCompare(left.observedAt) || right.createdAt.localeCompare(left.createdAt);
}

function resolveLimit(value: number | undefined): number {
  return Math.min(500, Math.max(1, Math.trunc(value ?? 100)));
}

function addParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function jsonRecord(value: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readSslConfig(env: Record<string, string | undefined>): PoolConfig["ssl"] {
  const value = env.COP_DATABASE_SSL?.trim().toLowerCase();
  if (value !== "true" && value !== "1" && value !== "require") {
    return false;
  }
  return {
    rejectUnauthorized: env.COP_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

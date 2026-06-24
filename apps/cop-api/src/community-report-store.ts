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
export type CommunityLocationSource = "device" | "manual" | "media_metadata" | "photo_exif" | "unknown";
export type CommunityAttachmentKind = "photo" | "video" | "document";
export type CommunityAttachmentStatus = "pending_upload" | "uploaded" | "failed" | "removed";
export type CommunityGroupVisibility = "private" | "public";
export type CommunityGroupMemberRole = "admin" | "member" | "owner";
export type CommunityGroupMemberStatus = "active" | "pending";

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

export interface CommunityGroupMemberRecord {
  displayName: string;
  joinedAt?: string;
  requestedAt: string;
  role: CommunityGroupMemberRole;
  status: CommunityGroupMemberStatus;
  subjectId: string;
  username: string;
}

interface CommunityGroupMemberWithGroupId extends CommunityGroupMemberRecord {
  groupId: string;
}

export interface CommunityGroupRecord {
  anchorLocation?: CommunityReportLocation;
  createdAt: string;
  createdBy: CommunityReportActor;
  description?: string;
  groupId: string;
  metadata: Record<string, unknown>;
  members: CommunityGroupMemberRecord[];
  name: string;
  updatedAt: string;
  visibility: CommunityGroupVisibility;
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

export interface CreateCommunityGroupInput {
  anchorLocation?: CommunityReportLocation;
  createdBy: CommunityReportActor;
  description?: string;
  metadata?: Record<string, unknown>;
  name: string;
  visibility: CommunityGroupVisibility;
}

export interface UpdateCommunityReportInput {
  category?: CommunityReportCategory;
  description?: string | null;
  location?: CommunityReportLocation;
  properties?: Record<string, unknown>;
  title?: string;
  validUntil?: string | null;
  visibility?: CommunityReportVisibility;
}

export interface CommunityGroupQuery {
  includePublic?: boolean;
  subjectId?: string;
}

export interface UpsertCommunityGroupMemberInput {
  actor: CommunityReportActor;
  groupId: string;
  member: CommunityReportActor;
  role?: CommunityGroupMemberRole;
  status: CommunityGroupMemberStatus;
}

export interface UpdateCommunityGroupMetadataInput {
  actor: CommunityReportActor;
  groupId: string;
  metadata: Record<string, unknown>;
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

export interface UpdateCommunityAttachmentMetadataInput {
  attachmentId: string;
  metadata: Record<string, unknown>;
  reportId: string;
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
  createGroup(input: CreateCommunityGroupInput, now: Date): Promise<CommunityGroupRecord>;
  createReport(input: CreateCommunityReportInput, now: Date): Promise<CommunityReportRecord>;
  deleteGroup(groupId: string, subjectId: string, now: Date): Promise<boolean>;
  deleteReport(reportId: string, subjectId: string, now: Date): Promise<boolean>;
  diagnostics?(): string | undefined;
  getGroup(groupId: string): Promise<CommunityGroupRecord | null>;
  getReport(reportId: string): Promise<CommunityReportRecord | null>;
  init(): Promise<void>;
  listGroups(query: CommunityGroupQuery): Promise<CommunityGroupRecord[]>;
  listReports(query: CommunityReportQuery): Promise<CommunityReportRecord[]>;
  requestGroupMembership(groupId: string, actor: CommunityReportActor, now: Date): Promise<CommunityGroupRecord | null>;
  submitReport(reportId: string, subjectId: string, now: Date): Promise<CommunityReportRecord | null>;
  updateAttachmentMetadata(input: UpdateCommunityAttachmentMetadataInput): Promise<CommunityReportAttachmentRecord | null>;
  updateGroupMetadata(input: UpdateCommunityGroupMetadataInput, now: Date): Promise<CommunityGroupRecord | null>;
  updateReport(reportId: string, subjectId: string, input: UpdateCommunityReportInput, now: Date): Promise<CommunityReportRecord | null>;
  upsertGroupMember(input: UpsertCommunityGroupMemberInput, now: Date): Promise<CommunityGroupRecord | null>;
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
  private readonly groups = new Map<string, CommunityGroupRecord>();
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

  async createGroup(input: CreateCommunityGroupInput, now: Date): Promise<CommunityGroupRecord> {
    const timestamp = now.toISOString();
    const owner: CommunityGroupMemberRecord = {
      displayName: input.createdBy.displayName,
      joinedAt: timestamp,
      requestedAt: timestamp,
      role: "owner",
      status: "active",
      subjectId: input.createdBy.subjectId,
      username: input.createdBy.username
    };
    const group: CommunityGroupRecord = {
      ...(input.anchorLocation ? { anchorLocation: input.anchorLocation } : {}),
      createdAt: timestamp,
      createdBy: input.createdBy,
      ...(input.description ? { description: input.description } : {}),
      groupId: randomUUID(),
      metadata: input.metadata ?? {},
      members: [owner],
      name: input.name,
      updatedAt: timestamp,
      visibility: input.visibility
    };
    this.groups.set(group.groupId, group);
    return group;
  }

  async getGroup(groupId: string): Promise<CommunityGroupRecord | null> {
    const group = this.groups.get(groupId);
    return group ? cloneCommunityGroup(group) : null;
  }

  async deleteGroup(groupId: string, subjectId: string, _now: Date): Promise<boolean> {
    const group = this.groups.get(groupId);
    if (!group || !canManageCommunityGroup(group, subjectId)) {
      return false;
    }
    this.groups.delete(groupId);
    return true;
  }

  async updateReport(reportId: string, subjectId: string, input: UpdateCommunityReportInput, now: Date): Promise<CommunityReportRecord | null> {
    const report = this.reports.get(reportId);
    if (!report || report.createdBy.subjectId !== subjectId || report.status === "hidden" || report.status === "rejected") {
      return null;
    }
    const timestamp = now.toISOString();
    const updated: CommunityReportRecord = {
      ...report,
      ...(input.category ? { category: input.category } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.location ? { location: input.location } : {}),
      ...(input.properties ? { properties: { ...report.properties, ...input.properties } } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {}),
      updatedAt: timestamp
    };
    if (input.description === null) {
      delete updated.description;
    }
    if (input.validUntil !== undefined) {
      updated.properties = {
        ...updated.properties,
        ...(input.validUntil ? { validUntil: input.validUntil } : {})
      };
      if (!input.validUntil) {
        delete updated.properties.validUntil;
      }
    }
    this.reports.set(reportId, updated);
    return { ...updated, attachments: this.attachmentsForReport(reportId) };
  }

  async deleteReport(reportId: string, subjectId: string, _now: Date): Promise<boolean> {
    const report = this.reports.get(reportId);
    if (!report || report.createdBy.subjectId !== subjectId) {
      return false;
    }
    this.reports.delete(reportId);
    for (const [attachmentId, attachment] of this.attachments.entries()) {
      if (attachment.reportId === reportId) {
        this.attachments.delete(attachmentId);
      }
    }
    return true;
  }

  async listGroups(query: CommunityGroupQuery): Promise<CommunityGroupRecord[]> {
    return Array.from(this.groups.values())
      .filter((group) => matchesCommunityGroupQuery(group, query))
      .sort(compareGroups)
      .map(cloneCommunityGroup);
  }

  async requestGroupMembership(groupId: string, actor: CommunityReportActor, now: Date): Promise<CommunityGroupRecord | null> {
    const group = this.groups.get(groupId);
    if (!group) {
      return null;
    }
    const timestamp = now.toISOString();
    const existing = group.members.find((member) => member.subjectId === actor.subjectId);
    const nextMembers = existing
      ? group.members.map((member) => member.subjectId === actor.subjectId ? { ...member, requestedAt: member.requestedAt ?? timestamp } : member)
      : [
          ...group.members,
          {
            displayName: actor.displayName,
            requestedAt: timestamp,
            role: "member" as const,
            status: group.visibility === "public" ? "active" as const : "pending" as const,
            subjectId: actor.subjectId,
            username: actor.username,
            ...(group.visibility === "public" ? { joinedAt: timestamp } : {})
          }
        ];
    const updated = { ...group, members: nextMembers, updatedAt: timestamp };
    this.groups.set(groupId, updated);
    return cloneCommunityGroup(updated);
  }

  async upsertGroupMember(input: UpsertCommunityGroupMemberInput, now: Date): Promise<CommunityGroupRecord | null> {
    const group = this.groups.get(input.groupId);
    if (!group || !canManageCommunityGroup(group, input.actor.subjectId)) {
      return null;
    }
    const timestamp = now.toISOString();
    const nextMembers = group.members.some((member) => member.subjectId === input.member.subjectId)
      ? group.members.map((member) => member.subjectId === input.member.subjectId
        ? {
            ...member,
            displayName: input.member.displayName,
            role: input.role ?? member.role,
            status: input.status,
            username: input.member.username,
            ...(input.status === "active" ? { joinedAt: member.joinedAt ?? timestamp } : {})
          }
        : member)
      : [
          ...group.members,
          {
            displayName: input.member.displayName,
            joinedAt: input.status === "active" ? timestamp : undefined,
            requestedAt: timestamp,
            role: input.role ?? "member",
            status: input.status,
            subjectId: input.member.subjectId,
            username: input.member.username
          }
        ];
    const updated = { ...group, members: nextMembers, updatedAt: timestamp };
    this.groups.set(input.groupId, updated);
    return cloneCommunityGroup(updated);
  }

  async updateGroupMetadata(input: UpdateCommunityGroupMetadataInput, now: Date): Promise<CommunityGroupRecord | null> {
    const group = this.groups.get(input.groupId);
    if (!group || !canUseCommunityGroup(group, input.actor.subjectId)) {
      return null;
    }
    const timestamp = now.toISOString();
    const updated: CommunityGroupRecord = {
      ...group,
      metadata: mergeCommunityGroupMetadata(group.metadata, input.metadata),
      updatedAt: timestamp
    };
    this.groups.set(input.groupId, updated);
    return cloneCommunityGroup(updated);
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

  async updateAttachmentMetadata(input: UpdateCommunityAttachmentMetadataInput): Promise<CommunityReportAttachmentRecord | null> {
    const attachment = this.attachments.get(input.attachmentId);
    if (!attachment || attachment.reportId !== input.reportId) {
      return null;
    }
    const updated: CommunityReportAttachmentRecord = {
      ...attachment,
      metadata: input.metadata
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
        location_geom,
        observed_at,
        properties,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11, $12,
        ST_SetSRID(ST_MakePoint($10::double precision, $9::double precision), 4326),
        $13::timestamptz, $14::jsonb, $15::timestamptz, $15::timestamptz
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

  async createGroup(input: CreateCommunityGroupInput, now: Date): Promise<CommunityGroupRecord> {
    const groupId = randomUUID();
    const timestamp = now.toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const groupResult = await client.query<CommunityGroupRow>(
        `INSERT INTO cop_community_groups (
          group_id, name, description, visibility, owner_subject_id, owner_username, owner_display_name,
          anchor_lat, anchor_lon, anchor_accuracy_m, anchor_location_source, anchor_geom, metadata, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          CASE
            WHEN $8::double precision IS NULL OR $9::double precision IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($9::double precision, $8::double precision), 4326)
          END,
          $12::jsonb, $13::timestamptz, $13::timestamptz
        )
        RETURNING *`,
        [
          groupId,
          input.name,
          input.description ?? null,
          input.visibility,
          input.createdBy.subjectId,
          input.createdBy.username,
          input.createdBy.displayName,
          input.anchorLocation?.lat ?? null,
          input.anchorLocation?.lon ?? null,
          input.anchorLocation?.accuracyM ?? null,
          input.anchorLocation?.source ?? null,
          JSON.stringify(input.metadata ?? {}),
          timestamp
        ]
      );
      await client.query(
        `INSERT INTO cop_community_group_members (
          group_id, subject_id, username, display_name, role, status, requested_at, joined_at
        )
        VALUES ($1, $2, $3, $4, 'owner', 'active', $5::timestamptz, $5::timestamptz)`,
        [groupId, input.createdBy.subjectId, input.createdBy.username, input.createdBy.displayName, timestamp]
      );
      await client.query("COMMIT");
      const row = groupResult.rows[0];
      if (!row) {
        throw new Error("Community group insert returned no row.");
      }
      return groupFromRow(row, await this.membersForGroups([groupId]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getGroup(groupId: string): Promise<CommunityGroupRecord | null> {
    const result = await this.pool.query<CommunityGroupRow>("SELECT * FROM cop_community_groups WHERE group_id = $1", [groupId]);
    const row = result.rows[0];
    return row ? groupFromRow(row, await this.membersForGroups([groupId])) : null;
  }

  async deleteGroup(groupId: string, subjectId: string, _now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM cop_community_groups g
      WHERE g.group_id = $1
        AND EXISTS (
          SELECT 1
          FROM cop_community_group_members m
          WHERE m.group_id = g.group_id
            AND m.subject_id = $2
            AND m.status = 'active'
            AND m.role IN ('owner', 'admin')
        )`,
      [groupId, subjectId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listGroups(query: CommunityGroupQuery): Promise<CommunityGroupRecord[]> {
    const params: unknown[] = [];
    const clauses = buildCommunityGroupQueryClauses(query, params);
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" OR ")}` : "";
    const result = await this.pool.query<CommunityGroupRow>(
      `SELECT DISTINCT g.*
      FROM cop_community_groups g
      LEFT JOIN cop_community_group_members m ON m.group_id = g.group_id
      ${whereClause}
      ORDER BY g.updated_at DESC, g.name ASC
      LIMIT 200`,
      params
    );
    const members = await this.membersForGroups(result.rows.map((row) => row.group_id));
    return result.rows.map((row) => groupFromRow(row, members));
  }

  async requestGroupMembership(groupId: string, actor: CommunityReportActor, now: Date): Promise<CommunityGroupRecord | null> {
    const group = await this.getGroup(groupId);
    if (!group) {
      return null;
    }
    const status: CommunityGroupMemberStatus = group.visibility === "public" ? "active" : "pending";
    const timestamp = now.toISOString();
    await this.pool.query(
      `INSERT INTO cop_community_group_members (
        group_id, subject_id, username, display_name, role, status, requested_at, joined_at
      )
      VALUES ($1, $2, $3, $4, 'member', $5, $6::timestamptz, $7::timestamptz)
      ON CONFLICT (group_id, subject_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        requested_at = COALESCE(cop_community_group_members.requested_at, EXCLUDED.requested_at),
        status = CASE WHEN cop_community_group_members.status = 'active' THEN 'active' ELSE EXCLUDED.status END,
        joined_at = CASE
          WHEN cop_community_group_members.status = 'active' THEN cop_community_group_members.joined_at
          WHEN EXCLUDED.status = 'active' THEN COALESCE(cop_community_group_members.joined_at, EXCLUDED.joined_at)
          ELSE cop_community_group_members.joined_at
        END`,
      [groupId, actor.subjectId, actor.username, actor.displayName, status, timestamp, status === "active" ? timestamp : null]
    );
    await this.touchGroup(groupId, timestamp);
    return this.getGroup(groupId);
  }

  async updateGroupMetadata(input: UpdateCommunityGroupMetadataInput, now: Date): Promise<CommunityGroupRecord | null> {
    const group = await this.getGroup(input.groupId);
    if (!group || !canUseCommunityGroup(group, input.actor.subjectId)) {
      return null;
    }
    const timestamp = now.toISOString();
    const metadata = mergeCommunityGroupMetadata(group.metadata, input.metadata);
    const result = await this.pool.query<CommunityGroupRow>(
      `UPDATE cop_community_groups
      SET metadata = $2::jsonb,
        updated_at = $3::timestamptz
      WHERE group_id = $1
      RETURNING *`,
      [
        input.groupId,
        JSON.stringify(metadata),
        timestamp
      ]
    );
    const row = result.rows[0];
    return row ? groupFromRow(row, await this.membersForGroups([input.groupId])) : null;
  }

  async upsertGroupMember(input: UpsertCommunityGroupMemberInput, now: Date): Promise<CommunityGroupRecord | null> {
    const group = await this.getGroup(input.groupId);
    if (!group || !canManageCommunityGroup(group, input.actor.subjectId)) {
      return null;
    }
    const timestamp = now.toISOString();
    await this.pool.query(
      `INSERT INTO cop_community_group_members (
        group_id, subject_id, username, display_name, role, status, requested_at, joined_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
      ON CONFLICT (group_id, subject_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        joined_at = CASE
          WHEN EXCLUDED.status = 'active' THEN COALESCE(cop_community_group_members.joined_at, EXCLUDED.joined_at)
          ELSE cop_community_group_members.joined_at
        END`,
      [
        input.groupId,
        input.member.subjectId,
        input.member.username,
        input.member.displayName,
        input.role ?? "member",
        input.status,
        timestamp,
        input.status === "active" ? timestamp : null
      ]
    );
    await this.touchGroup(input.groupId, timestamp);
    return this.getGroup(input.groupId);
  }

  async updateReport(reportId: string, subjectId: string, input: UpdateCommunityReportInput, now: Date): Promise<CommunityReportRecord | null> {
    const existing = await this.getReport(reportId);
    if (!existing || existing.createdBy.subjectId !== subjectId || existing.status === "hidden" || existing.status === "rejected") {
      return null;
    }
    const nextProperties = {
      ...existing.properties,
      ...(input.properties ?? {})
    };
    if (input.validUntil !== undefined) {
      if (input.validUntil) {
        nextProperties.validUntil = input.validUntil;
      } else {
        delete nextProperties.validUntil;
      }
    }
    const nextLocation = input.location ?? existing.location;
    const result = await this.pool.query<CommunityReportRow>(
      `UPDATE cop_community_reports
      SET
        category = $3,
        title = $4,
        description = $5,
        visibility = $6,
        lat = $7,
        lon = $8,
        location_accuracy_m = $9,
        location_source = $10,
        location_geom = ST_SetSRID(ST_MakePoint($8::double precision, $7::double precision), 4326),
        properties = $11::jsonb,
        updated_at = $12::timestamptz
      WHERE report_id = $1 AND subject_id = $2
      RETURNING *`,
      [
        reportId,
        subjectId,
        input.category ?? existing.category,
        input.title ?? existing.title,
        input.description === undefined ? existing.description ?? null : input.description,
        input.visibility ?? existing.visibility,
        nextLocation.lat,
        nextLocation.lon,
        nextLocation.accuracyM ?? null,
        nextLocation.source,
        JSON.stringify(nextProperties),
        now.toISOString()
      ]
    );
    const row = result.rows[0];
    return row ? reportFromRow(row, await this.attachmentsForReports([reportId])) : null;
  }

  async deleteReport(reportId: string, subjectId: string, _now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM cop_community_reports
      WHERE report_id = $1 AND subject_id = $2`,
      [reportId, subjectId]
    );
    return (result.rowCount ?? 0) > 0;
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
        capture_geom,
        upload_expires_at,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, 'pending_upload', $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, $14, $15,
        CASE
          WHEN $12::double precision IS NULL OR $13::double precision IS NULL THEN NULL
          ELSE ST_SetSRID(ST_MakePoint($13::double precision, $12::double precision), 4326)
        END,
        $16::timestamptz, $17::jsonb
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

  async updateAttachmentMetadata(input: UpdateCommunityAttachmentMetadataInput): Promise<CommunityReportAttachmentRecord | null> {
    const result = await this.pool.query<CommunityAttachmentRow>(
      `UPDATE cop_community_report_attachments
      SET metadata = $3::jsonb
      WHERE attachment_id = $1 AND report_id = $2
      RETURNING *`,
      [
        input.attachmentId,
        input.reportId,
        JSON.stringify(input.metadata)
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

  private async membersForGroups(groupIds: string[]): Promise<CommunityGroupMemberRecord[]> {
    if (groupIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<CommunityGroupMemberRow>(
      `SELECT *
      FROM cop_community_group_members
      WHERE group_id = ANY($1::uuid[])
      ORDER BY requested_at ASC`,
      [groupIds]
    );
    return result.rows.map(groupMemberFromRow);
  }

  private async touchGroup(groupId: string, timestamp: string): Promise<void> {
    await this.pool.query("UPDATE cop_community_groups SET updated_at = $2::timestamptz WHERE group_id = $1", [groupId, timestamp]);
  }
}

interface CommunityGroupRow extends QueryResultRow {
  anchor_accuracy_m: number | string | null;
  anchor_lat: number | string | null;
  anchor_location_source: CommunityLocationSource | null;
  anchor_lon: number | string | null;
  created_at: Date | string;
  description: string | null;
  group_id: string;
  metadata: Record<string, unknown> | string | null;
  name: string;
  owner_display_name: string;
  owner_subject_id: string;
  owner_username: string;
  updated_at: Date | string;
  visibility: CommunityGroupVisibility;
}

interface CommunityGroupMemberRow extends QueryResultRow {
  display_name: string;
  group_id: string;
  joined_at: Date | string | null;
  requested_at: Date | string;
  role: CommunityGroupMemberRole;
  status: CommunityGroupMemberStatus;
  subject_id: string;
  username: string;
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
CREATE EXTENSION IF NOT EXISTS postgis;

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

ALTER TABLE cop_community_reports
  ADD COLUMN IF NOT EXISTS location_geom geometry(Point, 4326);

UPDATE cop_community_reports
SET location_geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)
WHERE location_geom IS NULL;

CREATE INDEX IF NOT EXISTS cop_community_reports_status_observed_idx
  ON cop_community_reports (status, observed_at DESC);

CREATE INDEX IF NOT EXISTS cop_community_reports_subject_updated_idx
  ON cop_community_reports (subject_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS cop_community_reports_location_idx
  ON cop_community_reports (lat, lon);

CREATE INDEX IF NOT EXISTS cop_community_reports_location_gix
  ON cop_community_reports USING gist (location_geom);

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

ALTER TABLE cop_community_report_attachments
  ADD COLUMN IF NOT EXISTS capture_geom geometry(Point, 4326);

UPDATE cop_community_report_attachments
SET capture_geom = ST_SetSRID(ST_MakePoint(capture_lon, capture_lat), 4326)
WHERE capture_geom IS NULL
  AND capture_lon IS NOT NULL
  AND capture_lat IS NOT NULL;

CREATE INDEX IF NOT EXISTS cop_community_attachments_report_idx
  ON cop_community_report_attachments (report_id, created_at ASC);

CREATE INDEX IF NOT EXISTS cop_community_attachments_capture_gix
  ON cop_community_report_attachments USING gist (capture_geom)
  WHERE capture_geom IS NOT NULL;

CREATE TABLE IF NOT EXISTS cop_community_groups (
  group_id uuid PRIMARY KEY,
  name text NOT NULL,
  description text,
  visibility text NOT NULL,
  owner_subject_id text NOT NULL,
  owner_username text NOT NULL,
  owner_display_name text NOT NULL,
  anchor_lat double precision,
  anchor_lon double precision,
  anchor_accuracy_m double precision,
  anchor_location_source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cop_community_groups
  ADD COLUMN IF NOT EXISTS anchor_lat double precision,
  ADD COLUMN IF NOT EXISTS anchor_lon double precision,
  ADD COLUMN IF NOT EXISTS anchor_accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS anchor_location_source text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS anchor_geom geometry(Point, 4326);

UPDATE cop_community_groups
SET anchor_geom = ST_SetSRID(ST_MakePoint(anchor_lon, anchor_lat), 4326)
WHERE anchor_geom IS NULL
  AND anchor_lon IS NOT NULL
  AND anchor_lat IS NOT NULL;

CREATE TABLE IF NOT EXISTS cop_community_group_members (
  group_id uuid NOT NULL REFERENCES cop_community_groups(group_id) ON DELETE CASCADE,
  subject_id text NOT NULL,
  username text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz,
  PRIMARY KEY (group_id, subject_id)
);

CREATE INDEX IF NOT EXISTS cop_community_groups_visibility_idx
  ON cop_community_groups (visibility, updated_at DESC);

CREATE INDEX IF NOT EXISTS cop_community_groups_anchor_gix
  ON cop_community_groups USING gist (anchor_geom)
  WHERE anchor_geom IS NOT NULL;

CREATE INDEX IF NOT EXISTS cop_community_group_members_subject_idx
  ON cop_community_group_members (subject_id, status);
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

function groupFromRow(row: CommunityGroupRow, members: Array<CommunityGroupMemberRecord | CommunityGroupMemberWithGroupId>): CommunityGroupRecord {
  const description = row.description ?? undefined;
  const anchorLocation = row.anchor_lat === null || row.anchor_lon === null
    ? undefined
    : {
        ...(row.anchor_accuracy_m === null ? {} : { accuracyM: Number(row.anchor_accuracy_m) }),
        lat: Number(row.anchor_lat),
        lon: Number(row.anchor_lon),
        source: row.anchor_location_source ?? "unknown"
      };
  return {
    ...(anchorLocation ? { anchorLocation } : {}),
    createdAt: isoString(row.created_at),
    createdBy: {
      displayName: row.owner_display_name,
      subjectId: row.owner_subject_id,
      username: row.owner_username
    },
    ...(description ? { description } : {}),
    groupId: row.group_id,
    metadata: jsonRecord(row.metadata),
    members: members
      .filter((member) => !("groupId" in member) || member.groupId === row.group_id)
      .map((member) => ({
        displayName: member.displayName,
        ...(member.joinedAt ? { joinedAt: member.joinedAt } : {}),
        requestedAt: member.requestedAt,
        role: member.role,
        status: member.status,
        subjectId: member.subjectId,
        username: member.username
      })),
    name: row.name,
    updatedAt: isoString(row.updated_at),
    visibility: row.visibility
  };
}

function groupMemberFromRow(row: CommunityGroupMemberRow): CommunityGroupMemberWithGroupId {
  const joinedAt = row.joined_at ? isoString(row.joined_at) : undefined;
  return {
    displayName: row.display_name,
    groupId: row.group_id,
    ...(joinedAt ? { joinedAt } : {}),
    requestedAt: isoString(row.requested_at),
    role: row.role,
    status: row.status,
    subjectId: row.subject_id,
    username: row.username
  };
}

function cloneCommunityGroup(group: CommunityGroupRecord): CommunityGroupRecord {
  return {
    ...group,
    ...(group.anchorLocation ? { anchorLocation: { ...group.anchorLocation } } : {}),
    createdBy: { ...group.createdBy },
    metadata: { ...group.metadata },
    members: group.members.map((member) => ({ ...member }))
  };
}

function mergeCommunityGroupMetadata(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...current,
    ...patch
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
    const westParam = addParam(params, query.bbox.west);
    const southParam = addParam(params, query.bbox.south);
    const eastParam = addParam(params, query.bbox.east);
    const northParam = addParam(params, query.bbox.north);
    clauses.push(
      `location_geom && ST_MakeEnvelope(${westParam}, ${southParam}, ${eastParam}, ${northParam}, 4326)`
    );
  }
  return clauses;
}

function buildCommunityGroupQueryClauses(query: CommunityGroupQuery, params: unknown[]): string[] {
  const clauses: string[] = [];
  if (query.includePublic) {
    clauses.push("g.visibility = 'public'");
  }
  if (query.subjectId) {
    const subjectParam = addParam(params, query.subjectId);
    clauses.push(`(m.subject_id = ${subjectParam} AND m.status IN ('active', 'pending'))`);
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

function matchesCommunityGroupQuery(group: CommunityGroupRecord, query: CommunityGroupQuery): boolean {
  if (query.includePublic && group.visibility === "public") {
    return true;
  }
  if (query.subjectId && group.members.some((member) => member.subjectId === query.subjectId && (member.status === "active" || member.status === "pending"))) {
    return true;
  }
  return !query.includePublic && !query.subjectId;
}

function compareReports(left: CommunityReportRecord, right: CommunityReportRecord): number {
  return right.observedAt.localeCompare(left.observedAt) || right.createdAt.localeCompare(left.createdAt);
}

function compareGroups(left: CommunityGroupRecord, right: CommunityGroupRecord): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name, "cs");
}

function canManageCommunityGroup(group: CommunityGroupRecord, subjectId: string): boolean {
  return group.members.some((member) =>
    member.subjectId === subjectId
    && member.status === "active"
    && (member.role === "owner" || member.role === "admin")
  );
}

function canUseCommunityGroup(group: CommunityGroupRecord, subjectId: string): boolean {
  return group.members.some((member) =>
    member.subjectId === subjectId
    && member.status === "active"
  );
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

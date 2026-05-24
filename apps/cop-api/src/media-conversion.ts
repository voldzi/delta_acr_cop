import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommunityReportAttachmentRecord } from "./community-report-store.js";
import type { MediaStorage } from "./media-storage.js";

export type SpatialVideoDerivativeStatus = "failed" | "processing" | "queued" | "ready";

export interface SpatialVideoDerivativeMetadata {
  byteSize?: number;
  checksumSha256?: string;
  contentType?: string;
  createdAt?: string;
  derivativeId: "xr-sbs";
  error?: string;
  layout: "side_by_side";
  objectKey?: string;
  source: "server_ffmpeg";
  status: SpatialVideoDerivativeStatus;
  updatedAt: string;
}

export interface MediaConversionManager {
  close(): void;
  enqueueAttachment(input: {
    attachment: CommunityReportAttachmentRecord;
    requestNow: Date;
    reportId: string;
  }): Promise<CommunityReportAttachmentRecord>;
}

export interface MediaConversionLogger {
  error?: (input: unknown, message?: string) => void;
  info?: (input: unknown, message?: string) => void;
  warn?: (input: unknown, message?: string) => void;
}

export interface MediaConversionConfig {
  enabled: boolean;
  ffmpegPath: string;
  maxConcurrent: number;
  timeoutMs: number;
  workDir: string;
}

export interface MediaConversionManagerOptions {
  config: MediaConversionConfig;
  logger?: MediaConversionLogger;
  mediaStorage?: MediaStorage;
  runSpatialConversion?: (input: { attachment: CommunityReportAttachmentRecord; source: Buffer }) => Promise<Buffer>;
  updateAttachmentMetadata(input: {
    attachmentId: string;
    metadata: Record<string, unknown>;
    reportId: string;
  }): Promise<CommunityReportAttachmentRecord | null>;
}

interface QueuedSpatialConversion {
  attachment: CommunityReportAttachmentRecord;
  reportId: string;
}

const derivativeId = "xr-sbs" as const;

export function createMediaConversionManagerFromEnv(
  options: Omit<MediaConversionManagerOptions, "config">,
  env: Record<string, string | undefined> = process.env
): MediaConversionManager | undefined {
  const enabled = readBoolean(env.COP_MEDIA_SPATIAL_CONVERSION_ENABLED, false);
  if (!enabled || !options.mediaStorage) {
    return undefined;
  }
  return new AsyncMediaConversionManager({
    ...options,
    config: {
      enabled,
      ffmpegPath: env.COP_MEDIA_SPATIAL_FFMPEG_PATH?.trim() || "ffmpeg",
      maxConcurrent: readInteger(env.COP_MEDIA_SPATIAL_CONVERSION_MAX_CONCURRENT, 1, 1, 4),
      timeoutMs: readInteger(env.COP_MEDIA_SPATIAL_CONVERSION_TIMEOUT_MS, 600_000, 30_000, 3_600_000),
      workDir: env.COP_MEDIA_SPATIAL_CONVERSION_WORKDIR?.trim() || join(tmpdir(), "cop-media-conversions")
    }
  });
}

export class AsyncMediaConversionManager implements MediaConversionManager {
  private activeCount = 0;
  private closed = false;
  private readonly queue: QueuedSpatialConversion[] = [];

  constructor(private readonly options: MediaConversionManagerOptions) {}

  async enqueueAttachment(input: {
    attachment: CommunityReportAttachmentRecord;
    requestNow: Date;
    reportId: string;
  }): Promise<CommunityReportAttachmentRecord> {
    if (!this.options.config.enabled || !this.options.mediaStorage || !isAppleSpatialVideoAttachment(input.attachment)) {
      return input.attachment;
    }
    const current = readSpatialDerivative(input.attachment);
    if (current?.status === "ready" || current?.status === "queued" || current?.status === "processing") {
      return input.attachment;
    }
    const queued = await this.updateDerivative(input.attachment, {
      derivativeId,
      layout: "side_by_side",
      source: "server_ffmpeg",
      status: "queued",
      updatedAt: input.requestNow.toISOString()
    });
    const attachment = queued ?? input.attachment;
    this.queue.push({ attachment, reportId: input.reportId });
    this.pump();
    return attachment;
  }

  close(): void {
    this.closed = true;
    this.queue.length = 0;
  }

  private pump(): void {
    if (this.closed || this.activeCount >= this.options.config.maxConcurrent) {
      return;
    }
    const item = this.queue.shift();
    if (!item) {
      return;
    }
    this.activeCount += 1;
    void this.process(item)
      .catch((error) => {
        this.options.logger?.error?.({ err: error, attachmentId: item.attachment.attachmentId, reportId: item.reportId }, "Spatial video conversion failed.");
      })
      .finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
  }

  private async process(item: QueuedSpatialConversion): Promise<void> {
    const processingAt = new Date().toISOString();
    const processing = await this.updateDerivative(item.attachment, {
      derivativeId,
      layout: "side_by_side",
      source: "server_ffmpeg",
      status: "processing",
      updatedAt: processingAt
    });
    const attachment = processing ?? item.attachment;
    try {
      const source = await this.options.mediaStorage?.getObject({ objectKey: attachment.objectKey }, new Date());
      if (!source) {
        throw new Error("media storage is not configured");
      }
      const output = this.options.runSpatialConversion
        ? await this.options.runSpatialConversion({ attachment, source: source.body })
        : await convertAppleSpatialMovWithFfmpeg(source.body, attachment, this.options.config);
      const objectKey = derivativeObjectKey(attachment.reportId, attachment.attachmentId);
      await this.options.mediaStorage?.putObject({
        body: output,
        contentType: "video/mp4",
        objectKey
      }, new Date());
      const checksumSha256 = createHash("sha256").update(output).digest("hex");
      await this.updateDerivative(attachment, {
        byteSize: output.length,
        checksumSha256,
        contentType: "video/mp4",
        createdAt: processingAt,
        derivativeId,
        layout: "side_by_side",
        objectKey,
        source: "server_ffmpeg",
        status: "ready",
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      await this.updateDerivative(attachment, {
        derivativeId,
        error: errorMessage(error),
        layout: "side_by_side",
        source: "server_ffmpeg",
        status: "failed",
        updatedAt: new Date().toISOString()
      });
      throw error;
    }
  }

  private async updateDerivative(
    attachment: CommunityReportAttachmentRecord,
    derivative: SpatialVideoDerivativeMetadata
  ): Promise<CommunityReportAttachmentRecord | null> {
    const metadata = withSpatialDerivative(attachment.metadata, derivative);
    return this.options.updateAttachmentMetadata({
      attachmentId: attachment.attachmentId,
      metadata,
      reportId: attachment.reportId
    });
  }
}

export function isAppleSpatialVideoAttachment(attachment: CommunityReportAttachmentRecord): boolean {
  if (attachment.kind !== "video" || attachment.status !== "uploaded") {
    return false;
  }
  const spatialVideo = readRecord(attachment.metadata.spatialVideo);
  return spatialVideo?.mode === "apple_mv_hevc";
}

export function readSpatialDerivative(attachment: { metadata?: Record<string, unknown> }): SpatialVideoDerivativeMetadata | null {
  const spatialVideo = readRecord(attachment.metadata?.spatialVideo);
  const derivative = readRecord(spatialVideo?.xrDerivative);
  if (!derivative || derivative.derivativeId !== derivativeId || !isDerivativeStatus(derivative.status)) {
    return null;
  }
  return {
    ...(typeof derivative.byteSize === "number" ? { byteSize: derivative.byteSize } : {}),
    ...(typeof derivative.checksumSha256 === "string" ? { checksumSha256: derivative.checksumSha256 } : {}),
    ...(typeof derivative.contentType === "string" ? { contentType: derivative.contentType } : {}),
    ...(typeof derivative.createdAt === "string" ? { createdAt: derivative.createdAt } : {}),
    derivativeId,
    ...(typeof derivative.error === "string" ? { error: derivative.error } : {}),
    layout: "side_by_side",
    ...(typeof derivative.objectKey === "string" ? { objectKey: derivative.objectKey } : {}),
    source: "server_ffmpeg",
    status: derivative.status,
    updatedAt: typeof derivative.updatedAt === "string" ? derivative.updatedAt : new Date(0).toISOString()
  };
}

export function withSpatialDerivative(
  metadata: Record<string, unknown>,
  derivative: SpatialVideoDerivativeMetadata
): Record<string, unknown> {
  const spatialVideo = readRecord(metadata.spatialVideo) ?? {};
  return {
    ...metadata,
    spatialVideo: {
      ...spatialVideo,
      browserPlayback: "2d_fallback",
      mode: "apple_mv_hevc",
      storage: "original_with_xr_derivative",
      xrDerivative: derivative
    }
  };
}

export function derivativeObjectKey(reportId: string, attachmentId: string): string {
  return `community-reports/${reportId}/${attachmentId}/derivatives/${derivativeId}.mp4`;
}

async function convertAppleSpatialMovWithFfmpeg(
  source: Buffer,
  attachment: CommunityReportAttachmentRecord,
  config: MediaConversionConfig
): Promise<Buffer> {
  await mkdir(config.workDir, { recursive: true });
  const jobId = randomUUID();
  const inputPath = join(config.workDir, `${jobId}-${safeFileName(attachment.fileName ?? "input.mov")}`);
  const outputPath = join(config.workDir, `${jobId}-xr-sbs.mp4`);
  try {
    await writeFile(inputPath, source);
    await runFfmpeg(config.ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-filter_complex",
      "[0:v:0][0:v:1]hstack=inputs=2[v]",
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath
    ], config.timeoutMs);
    return await readFile(outputPath);
  } finally {
    await Promise.all([
      rm(inputPath, { force: true }),
      rm(outputPath, { force: true })
    ]);
  }
}

function runFfmpeg(ffmpegPath: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 3000) {
        stderr = stderr.slice(-3000);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}: ${stderr.trim() || "no stderr"}`));
      }
    });
  });
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "_").slice(0, 120) || "input.mov";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isDerivativeStatus(value: unknown): value is SpatialVideoDerivativeStatus {
  return value === "queued" || value === "processing" || value === "ready" || value === "failed";
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function readInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
